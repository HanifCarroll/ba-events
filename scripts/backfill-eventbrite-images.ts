#!/usr/bin/env bun
/** Future-only Eventbrite detail-image backfill. Dry-run unless --apply is passed. */
import { createClient } from '@supabase/supabase-js'
import { fetchEventbriteDetail } from '#features/import/scrapers/eventbrite/detail.ts'

export interface BackfillArgs {
  apply: boolean
  limit: number
  runAt: string
}

export function parseArgs(argv: string[], runAt = new Date().toISOString()): BackfillArgs {
  const index = argv.indexOf('--limit')
  const requestedLimit = index >= 0 ? Number(argv[index + 1]) : 1000
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) {
    throw new Error('--limit must be an integer between 1 and 1000')
  }
  const limit = requestedLimit
  return { apply: argv.includes('--apply'), limit, runAt }
}

export function isFutureEvent(startsAt: string, runAt: string): boolean {
  return new Date(startsAt).getTime() > new Date(runAt).getTime()
}

interface Row {
  id: string
  starts_at: string
  link: string | null
  image_url: string | null
  image_width: number | null
  image_height: number | null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const db = createClient(url, key)
  const { data, error } = await db
    .from('events')
    .select('id, starts_at, link, image_url, image_width, image_height')
    .eq('source', 'eventbrite')
    .gt('starts_at', args.runAt)
    .order('starts_at')
    .limit(args.limit)
  if (error) throw error

  let checked = 0
  let improved = 0
  let updated = 0
  let failed = 0
  for (const row of (data ?? []) as Row[]) {
    if (!isFutureEvent(row.starts_at, args.runAt) || !row.link) continue
    checked++
    const detail = await fetchEventbriteDetail(row.link)
    const usable = detail?.image_url && detail.image_width && detail.image_height
    if (!usable) continue
    const unchanged =
      detail.image_url === row.image_url &&
      detail.image_width === row.image_width &&
      detail.image_height === row.image_height
    if (unchanged) continue
    improved++
    if (!args.apply) continue
    const result = await db
      .from('events')
      .update({ image_url: detail.image_url, image_width: detail.image_width, image_height: detail.image_height })
      .eq('id', row.id)
      .eq('source', 'eventbrite')
      .gt('starts_at', args.runAt)
    if (result.error) failed++
    else updated++
  }
  console.log(JSON.stringify({ runAt: args.runAt, dryRun: !args.apply, checked, improved, updated, failed }))
}

if (import.meta.main) await main()
