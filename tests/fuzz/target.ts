import assert from 'node:assert/strict'
import { normalizeText } from '../../src/shared/lib/utils/normalize-text'
import { openTelegramEnvelope, sealTelegramEnvelope } from '../../src/features/telegram/envelope.server'

// Synthetic key only; never read deployment configuration in a fuzz target.
const key = Buffer.alloc(32, 7).toString('base64')
export function fuzz(data: Buffer) {
  const text = data.toString('utf8')
  fuzzWorkflowBoundaries(data, text)
  const normalized = normalizeText(text)
  assert.equal(normalizeText(normalized), normalized)
  assert.match(normalized, /^[a-z0-9]*(?: [a-z0-9]+)*$/)
  const sealed = sealTelegramEnvelope({ text }, key, 'update-1', 'queue-1')
  assert.deepEqual(openTelegramEnvelope(sealed, key, 'update-1', 'queue-1'), { text })
  assert.throws(() => openTelegramEnvelope(sealed, key, 'update-2', 'queue-1'))
  const tampered = Buffer.from(sealed, 'base64')
  tampered[tampered.length - 1] ^= 1
  assert.throws(() => openTelegramEnvelope(tampered.toString('base64'), key, 'update-1', 'queue-1'))
}

import { Schema } from 'effect'
import { parseTelegramUpdate, parseTelegramText } from '../../src/features/telegram/update'
import { parseTelegramPlaintextPayload, parseTelegramTaskPayload } from '../../src/features/telegram/task-payload'
import { parseChatTurnBootstrapInput } from '../../src/features/chat/api/turn-authority'
import { CandidateSchema } from '../../src/features/import/intake/schema'
import { candidateStart, validateEvidence } from '../../src/features/import/intake/planning'
import { ChatEventDecoder, eventData, eventOffset } from '../../src/features/chat/lib/delivery-protocol'

function fuzzWorkflowBoundaries(data: Buffer, text: string) {
  // Fragmentation must not corrupt canonical response frames or replay offsets,
  // including CRLF split across network chunks and Unicode payloads.
  const payload = JSON.stringify({ text })
  const wire = `id: 7\r\ndata: ${payload}\r\n\r\n`
  const decoder = new ChatEventDecoder()
  const width = 1 + (data[0] ?? 0)
  const frames: string[] = []
  for (let start = 0; start < wire.length; start += width) frames.push(...decoder.push(wire.slice(start, start + width)))
  assert.equal(frames.length, 1)
  assert.equal(eventData(frames[0]), payload)
  assert.equal(eventOffset(frames[0]), 7)
  const command = parseTelegramText(text)
  if (command?.kind === 'text') assert.ok(command.text.length && !command.text.startsWith('/'))

  let value: unknown
  try { value = JSON.parse(text) } catch (error) { if (error instanceof SyntaxError) return; throw error }
  const roundtrip = JSON.parse(JSON.stringify(value))
  for (const parse of [parseTelegramUpdate, parseTelegramPlaintextPayload, parseTelegramTaskPayload, parseChatTurnBootstrapInput]) {
    const accepted = parse(value)
    if (accepted) assert.deepEqual(parse(roundtrip), accepted)
  }
  const update = parseTelegramUpdate(value)
  if (update) {
    const source = 'message' in update ? update.message : update.callback_query
    const chat = 'message' in update ? update.message.chat : update.callback_query.message.chat
    assert.equal(source.from.is_bot, false)
    assert.equal(chat.type, 'private')
    assert.match(update.update_id, /^\d+$/)
  }
  const candidate = Schema.decodeUnknownResult(CandidateSchema, { onExcessProperty: 'error' })(value)
  if (candidate._tag === 'Success') {
    const reasons = validateEvidence(candidate.success, [], [], new Date('2026-10-31T12:00:00Z'))
    assert.ok(reasons.includes('Evidence observation is missing'))
    assert.ok(reasons.includes('Missing evidence for name'))
    try {
      const start = candidateStart(candidate.success)
      assert.ok(Number.isFinite(Date.parse(start)))
    } catch (error) {
      assert.ok(error instanceof Error && error.message === 'Invalid calendar date')
      assert.ok(reasons.includes('Invalid calendar date'))
    }
  }
}
