/**
 * Backfill structured description presentation fields for existing events.
 *
 * Run with:
 *   bun scripts/backfill-description-presentation.ts
 *   bun scripts/backfill-description-presentation.ts --retry-failed
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildDescriptionPresentationFields } from '@/features/events/lib/description-presentation.server'

config({ path: '.env' })

const BATCH_SIZE = Number(process.env.BACKFILL_BATCH_SIZE ?? 25)
const SCAN_LIMIT = Number(process.env.BACKFILL_SCAN_LIMIT ?? 400)
const MAX_RETRIES = Number(process.env.BACKFILL_MAX_RETRIES ?? 3)
const CONCURRENCY = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY ?? 4))
const STATUS_SCOPE = process.env.BACKFILL_STATUS_SCOPE ?? 'all'
const STARTS_AFTER = process.env.BACKFILL_STARTS_AFTER ?? null
const STARTS_BEFORE = process.env.BACKFILL_STARTS_BEFORE ?? null
const CHECKPOINT_PATH = path.resolve(
  process.cwd(),
  'scripts/.backfill-description-presentation.checkpoint.json'
)

const PRESENTATION_GAP_FILTER =
  'and(description_es.not.is.null,or(description_display_es.is.null,description_summary_es.is.null)),' +
  'and(description_en.not.is.null,or(description_display_en.is.null,description_summary_en.is.null))'

interface BackfillRow {
  id: string
  name: string
  description_es: string | null
  description_en: string | null
}

interface BackfillCheckpoint {
  version: 1
  updatedCount: number
  failedCount: number
  skippedEventIds: string[]
  lastRunAt: string
}

const DEFAULT_CHECKPOINT: BackfillCheckpoint = {
  version: 1,
  updatedCount: 0,
  failedCount: 0,
  skippedEventIds: [],
  lastRunAt: new Date().toISOString(),
}

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readCheckpoint(retryFailed: boolean): Promise<BackfillCheckpoint> {
  if (!(await fileExists(CHECKPOINT_PATH))) {
    return { ...DEFAULT_CHECKPOINT }
  }

  const raw = await fs.readFile(CHECKPOINT_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as BackfillCheckpoint
  const checkpoint: BackfillCheckpoint = {
    version: 1,
    updatedCount: parsed.updatedCount ?? 0,
    failedCount: parsed.failedCount ?? 0,
    skippedEventIds: parsed.skippedEventIds ?? [],
    lastRunAt: parsed.lastRunAt ?? new Date().toISOString(),
  }

  if (retryFailed) {
    checkpoint.failedCount = 0
    checkpoint.skippedEventIds = []
  }

  return checkpoint
}

async function writeCheckpoint(checkpoint: BackfillCheckpoint): Promise<void> {
  const next = {
    ...checkpoint,
    lastRunAt: new Date().toISOString(),
  }
  await fs.writeFile(CHECKPOINT_PATH, JSON.stringify(next, null, 2), 'utf-8')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRequireSpanishPresentation(row: BackfillRow): boolean {
  return Boolean(row.description_es && row.description_es.trim().length > 0)
}

function shouldRequireEnglishPresentation(row: BackfillRow): boolean {
  return Boolean(row.description_en && row.description_en.trim().length > 0)
}

async function buildPresentationWithRetry(row: BackfillRow) {
  let attempt = 0
  let lastError: unknown

  while (attempt < MAX_RETRIES) {
    attempt += 1

    try {
      const fields = await buildDescriptionPresentationFields({
        description_es: row.description_es,
        description_en: row.description_en,
      })

      if (
        shouldRequireSpanishPresentation(row) &&
        (!fields.description_display_es || !fields.description_summary_es)
      ) {
        throw new Error('Missing Spanish display or summary output')
      }

      if (
        shouldRequireEnglishPresentation(row) &&
        (!fields.description_display_en || !fields.description_summary_en)
      ) {
        throw new Error('Missing English display or summary output')
      }

      return fields
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES) {
        const backoffMs = 1000 * 2 ** (attempt - 1)
        await delay(backoffMs)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown backfill failure')
}

async function fetchPresentationGaps() {
  const supabase = getSupabaseAdminClient()
  let query = supabase
    .from('events')
    .select('id, name, description_es, description_en')
    .or(PRESENTATION_GAP_FILTER)
    .order('updated_at', { ascending: true })
    .limit(SCAN_LIMIT)

  if (STATUS_SCOPE === 'non_past') {
    query = query.neq('status', 'past')
  } else if (STATUS_SCOPE === 'scheduled_only') {
    query = query.eq('status', 'scheduled')
  }

  if (STARTS_AFTER) {
    query = query.gte('starts_at', STARTS_AFTER)
  }

  if (STARTS_BEFORE) {
    query = query.lte('starts_at', STARTS_BEFORE)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to fetch presentation gaps: ${error.message}`)
  }

  return (data ?? []) as BackfillRow[]
}

async function updatePresentationFields(id: string, fields: Awaited<ReturnType<typeof buildDescriptionPresentationFields>>) {
  const supabase = getSupabaseAdminClient()
  const { error } = await supabase
    .from('events')
    .update(fields)
    .eq('id', id)

  if (error) {
    throw new Error(`Failed to update event ${id}: ${error.message}`)
  }
}

async function main() {
  const retryFailed = process.argv.includes('--retry-failed')
  const checkpoint = await readCheckpoint(retryFailed)
  const skippedIds = new Set(checkpoint.skippedEventIds)

  console.log(`[backfill] Starting structured description backfill`)
  console.log(
    `[backfill] Batch size: ${BATCH_SIZE}, scan limit: ${SCAN_LIMIT}, retries: ${MAX_RETRIES}, concurrency: ${CONCURRENCY}`
  )
  console.log(
    `[backfill] Scope: status=${STATUS_SCOPE}, starts_after=${STARTS_AFTER ?? 'none'}, starts_before=${STARTS_BEFORE ?? 'none'}`
  )
  if (retryFailed) {
    console.log('[backfill] Retrying previously failed events')
  } else if (skippedIds.size > 0) {
    console.log(`[backfill] Skipping ${skippedIds.size} previously failed events (use --retry-failed to retry)`)
  }

  let runUpdated = 0
  let runFailed = 0

  while (true) {
    const rows = await fetchPresentationGaps()
    const candidates = rows.filter((row) => !skippedIds.has(row.id))
    const batch = candidates.slice(0, BATCH_SIZE)

    if (batch.length === 0) {
      if (rows.length > 0 && skippedIds.size > 0) {
        console.log('[backfill] Remaining rows are currently in skipped set. Stopping this run.')
      }
      break
    }

    console.log(`[backfill] Processing batch of ${batch.length} events`)

    const queue = [...batch]
    const workerCount = Math.min(CONCURRENCY, queue.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const row = queue.shift()
        if (!row) break

        try {
          const fields = await buildPresentationWithRetry(row)
          await updatePresentationFields(row.id, fields)

          runUpdated++
          checkpoint.updatedCount += 1
          console.log(`[backfill] Updated ${row.id} (${row.name})`)
        } catch (error) {
          runFailed++
          checkpoint.failedCount += 1
          skippedIds.add(row.id)
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[backfill] Failed ${row.id} (${row.name}): ${message}`)
        }
      }
    })

    await Promise.all(workers)

    checkpoint.skippedEventIds = [...skippedIds]
    await writeCheckpoint(checkpoint)
  }

  checkpoint.skippedEventIds = [...skippedIds]
  await writeCheckpoint(checkpoint)

  console.log('\n[backfill] Completed')
  console.log(`[backfill] Updated this run: ${runUpdated}`)
  console.log(`[backfill] Failed this run: ${runFailed}`)
  console.log(`[backfill] Lifetime updated: ${checkpoint.updatedCount}`)
  console.log(`[backfill] Lifetime failed: ${checkpoint.failedCount}`)
  console.log(`[backfill] Checkpoint: ${CHECKPOINT_PATH}`)
}

main().catch((error) => {
  console.error('[backfill] Fatal error:', error)
  process.exit(1)
})
