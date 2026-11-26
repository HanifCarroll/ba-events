/** Real SDK transport with synthetic search reads and no network. */
import { writeFileSync } from 'node:fs'
import { frozenEvents } from '../../../../../evals/concierge/frozen-corpus.ts'
import { orchestrate } from './orchestrate.ts'
import { searchContextFromCanonical } from './search-context.ts'

type Locale = 'en' | 'es'
type ProviderRequest = {
  thinking?: { type: string }
  tool_choice?: string | { type: string; function?: { name: string } }
  stream?: boolean
}

const thinkingError = 'Thinking mode does not support this tool_choice'
const [firstEvent, nextEvent] = frozenEvents()

async function runConversation(locale: Locale, streaming: boolean, exhausted: boolean) {
  async function turn(originalQuery: string, previous?: Awaited<ReturnType<typeof orchestrate>>) {
    const requests: Array<ProviderRequest & { status: number }> = []
    const inventory = previous && exhausted ? [firstEvent] : [firstEvent, nextEvent]
    globalThis.fetch = async (_url, init) => {
      const { thinking, tool_choice, stream }: ProviderRequest = JSON.parse(String(init?.body))
      const forced = tool_choice === 'required' || (typeof tool_choice === 'object' && tool_choice.type === 'function')
      const rejected = thinking?.type === 'enabled' && forced
      requests.push({ thinking, tool_choice, stream: stream === true, status: rejected ? 400 : 200 })
      if (rejected) return Response.json({ error: { message: thinkingError, type: 'invalid_request_error' } }, { status: 400 })

      // Propose a different window on the repeat so the real server must restore
      // the previous search filters instead of relying on the fixture model.
      const call = requests.length === 1 ? {
        id: 'search-call', type: 'function', function: { name: 'search_events', arguments: JSON.stringify({
          objective: 'search', limit: 1, ...(previous ? { timeFilter: 'future' } : { timeFilter: 'today', isFree: true }),
        }) },
      } : null
      const text = locale === 'es'
        ? 'ACK: Encontré una opción.\nREASON_1: La descripción menciona música en vivo.\nNEXT: ¿Querés ver cómo llegar?'
        : 'ACK: I found an option.\nREASON_1: The listing describes live music.\nNEXT: Would you like directions?'
      const message = { role: 'assistant', content: call ? null : text,
        ...(call ? { tool_calls: [call], ...(thinking?.type === 'enabled' ? { reasoning_content: 'Find events.' } : {}) } : {}) }
      const envelope = { id: `response-${requests.length}`, created: 1, model: 'deepseek-flash' }
      const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 }
      const finish_reason = call ? 'tool_calls' : 'stop'
      if (!stream) return Response.json({ ...envelope, object: 'chat.completion', usage,
        choices: [{ index: 0, finish_reason, message }] })

      const delta = call ? { ...message, tool_calls: [{ index: 0, ...call }] } : message
      const chunk = { ...envelope, object: 'chat.completion.chunk', usage, choices: [{ index: 0, delta, finish_reason }] }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    const result = await orchestrate({
      requestId: previous ? 'alternatives' : 'today', locale, originalQuery,
      userContext: { userId: null, isAuthenticated: false }, priorDisplayedEvents: [],
      lastSearch: searchContextFromCanonical(previous?.canonical),
      shownEventIds: new Set(previous?.canonical.events.map(event => event.id)),
      ...(streaming ? { onProgress: () => {} } : {}),
      readExecutors: { search: async (input, context) => {
        const unseen = context.excludeShownEvents ? inventory.filter(event => !context.shownEventIds?.has(event.id)) : inventory
        return { success: true, formatted: '{}', events: unseen.slice(0, input.limit),
          metadata: { toolInput: input, totalMatches: inventory.length, previouslyShownMatches: inventory.length - unseen.length } }
      } },
    })
    return { result, requests }
  }

  const first = await turn(locale === 'es' ? '¿Qué hay hoy?' : "What's on today?")
  const chip = first.result.canonical.suggestions.find(suggestion => suggestion.id === 'show-alternatives')
  if (!chip) throw new Error('The first result did not offer alternatives')
  const repeat = await turn(chip.prompt, first.result)
  const summary = ({ result, requests }: Awaited<ReturnType<typeof turn>>) => ({
    requests, kind: result.canonical.kind, text: result.canonical.text,
    eventIds: result.canonical.events.map(event => event.id), fallback: result.canonical.provenance.fallbackUsed,
    search: result.reads.find(read => read.toolName === 'search_events')?.input,
  })
  return { prompt: chip.prompt, first: summary(first), repeat: summary(repeat) }
}

writeFileSync(process.argv[2], JSON.stringify({
  english: await runConversation('en', true, false),
  spanish: await runConversation('es', true, true),
  nonStreaming: await runConversation('en', false, false),
}))
