/**
 * BA Eventos Instagram publisher (VPS). Drafts the Hoy, Este finde, Gratis, and Este finde Reel posts from the catalog, previews them
 * in Slack when approval is needed, and publishes approved drafts. See docs/instagram-publisher.md.
 *
 *   tick                                             do whatever is due (the systemd timer runs this every 10 minutes)
 *   dry-run <hoy|finde|gratis|reel> --date <YYYY-MM-DD> --out <dir> [--track <id>] [--threads]  render a draft without publishing
 *   review <draft id> [--dry-run]                    print a fresh verdict without acting
 *   investigate <draft id> [--dry-run]               queue or inspect the guarded follow-up to a saved review
 *   catalog-fix <id> --field <field> --from <value> --to <value> --evidence <source> [--all-occurrences] (active investigation only)
 *   threads-report [--days 28]                       read Threads insights for posts from this publisher
 *   stickers-dry-run <hoy draft id> --out <dir>       capture every Instagram preview and discard without sharing
 *   approve|skip <draft id> --revision <n> --reason "<instruction source>"  record Hanif's decision on his behalf
 *   regenerate <draft id> [--exclude <event id> ...] [--track <id>]  rebuild a draft (a Reel may switch track) and preview it again
 *   status                                           list the drafts, their state, and their times
 */
import { parseArgs } from 'node:util'
import { isFormatKey } from '../src/features/instagram-publisher/formats.ts'
import { Job, dryRun, liveServices, regenerate, review, status, stickersDryRun, tick } from '../src/features/instagram-publisher/job.ts'
import { InvestigatorToolError, investigatorErrorMessage } from '../src/features/instagram-publisher/investigator-error.ts'
import { catalogFix, investigatorTool, runInvestigator } from '../src/features/instagram-publisher/investigator-run.ts'
import { renderFramesInProcess, withLock } from '../src/features/instagram-publisher/runtime.ts'
import { threadsApi } from '../src/features/instagram-publisher/threads-api.ts'
import { threadsReport } from '../src/features/instagram-publisher/threads-report.ts'
import { readThreadsToken } from '../src/features/instagram-publisher/threads-token.ts'

const USAGE = 'usage: instagram-publisher.ts tick | status | review <draft id> [--dry-run] | investigate <draft id> [--dry-run] | catalog-fix <id> --field <field> --from <value> --to <value> --evidence <source> [--all-occurrences] | dry-run <hoy|finde|gratis|reel> --date <YYYY-MM-DD> --out <dir> [--track <id>] [--threads] | threads-report [--days 28] | approve|skip <draft id> --revision <n> --reason "<instruction source>" | regenerate <draft id> [--exclude <event id> ...] [--track <id>] | stickers-dry-run <hoy draft id> --out <dir>'

function flags(args: string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index++) if (args[index] === `--${name}` && args[index + 1]) values.push(args[++index]!)
  return values
}

async function main(argv: string[]) {
  const [command, ...args] = argv
  switch (command) {
    case 'tick': return tick()
    case 'status': return status()
    case 'dry-run': {
      const [format] = args
      const [date] = flags(args, 'date')
      const [out] = flags(args, 'out')
      const [track] = flags(args, 'track')
      if (!format || !isFormatKey(format) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !out) throw new Error(USAGE)
      return dryRun(format, date, out, { trackId: track, threads: args.includes('--threads') })
    }
    case 'review': {
      const [id, flag] = args
      if (!id || args.length > 2 || (flag !== undefined && flag !== '--dry-run')) throw new Error(USAGE)
      return review(id)
    }
    case 'investigate': {
      const [id, flag] = args
      if (!id || args.length > 2 || (flag !== undefined && flag !== '--dry-run')) throw new Error(USAGE)
      const job = new Job(liveServices())
      const plan = flag ? await job.investigate(id, true) : await withLock(() => job.investigate(id, false))
      console.log(JSON.stringify(plan, null, 2))
      return
    }
    case 'catalog-fix': {
      const [id, ...options] = args
      const { values } = parseArgs({ args: options, options: { field: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
        evidence: { type: 'string' }, 'all-occurrences': { type: 'boolean' } } })
      const dir = process.env.BA_INVESTIGATION_DIR
      const { from, to, field, evidence } = values
      if (!dir) throw new InvestigatorToolError('catalog-fix requires an active investigator request.')
      if (!id || field === undefined || from === undefined || to === undefined || evidence === undefined) throw new Error(USAGE)
      const { fixInput } = await import('../src/features/instagram-publisher/catalog-fix.ts')
      const input = fixInput.parse({ id, field, from: from === 'null' ? null : from, to: to === 'null' ? null : to, evidence, allOccurrences: values['all-occurrences'] === true })
      console.log(JSON.stringify(await catalogFix(dir, input)))
      return
    }
    case 'investigator-run': return runInvestigator(args[0]!)
    case 'investigator-tool': {
      const [dir, action, data] = args
      console.log(JSON.stringify(await investigatorTool(dir!, action!, data!)))
      return
    }
    case 'threads-report': {
      const [flag, value] = args
      const days = args.length ? Number(value) : 28
      if ((args.length && (args.length !== 2 || flag !== '--days')) || !Number.isSafeInteger(days) || days < 1) throw new Error(USAGE)
      const job = new Job(liveServices())
      if (!job.s.config().threads.enabled) throw new Error('Threads is disabled in the publisher config.')
      const api = await threadsApi(readThreadsToken().access_token)
      console.log(await threadsReport(job.allDrafts(), api, job.s.now(), days))
      return
    }
    case 'stickers-dry-run': {
      const [id] = args
      const [out] = flags(args, 'out')
      if (!id || !out) throw new Error(USAGE)
      return stickersDryRun(id, out)
    }
    case 'approve':
    case 'skip': {
      const [id, ...options] = args
      const { values } = parseArgs({ args: options, options: { revision: { type: 'string' }, reason: { type: 'string' } } })
      const revision = Number(values.revision)
      const reason = values.reason?.trim()
      if (!id || !values.revision || !/^\d+$/.test(values.revision) || !Number.isSafeInteger(revision) || revision < 1 || !reason) {
        throw new Error(`usage: instagram-publisher.ts ${command} <draft id> --revision <n> --reason "<instruction source>"`)
      }
      const saved = await withLock(() => new Job(liveServices()).delegateDecision(command, id, revision, reason))
      const decision = command === 'approve' ? 'approval' : 'veto'
      console.log(`${id} r${revision}: ${saved ? `recorded Hermes's ${decision} on Hanif's behalf` : `Hermes's ${decision} is already recorded`}.`)
      return
    }
    case 'regenerate': {
      const [id] = args
      const exclude = flags(args, 'exclude')
      const [track] = flags(args, 'track')
      if (!id || (!exclude.length && !track)) throw new Error(USAGE)
      return regenerate(id, exclude, track ?? null)
    }
    // Internal: the memory-capped child process that drives Chromium.
    case 'render-frames': {
      const [html, out, height] = args
      const count = await renderFramesInProcess(html!, out!, Number(height))
      return void console.log(`${count} frames`)
    }
    default: throw new Error(USAGE)
  }
}

main(process.argv.slice(2)).catch(error => {
  if (process.argv[2] === 'investigator-tool' || process.argv[2] === 'catalog-fix') {
    // tools.mjs accepts only this handled failure status, not Node crashes or spawn errors.
    console.error(investigatorErrorMessage(error))
    process.exitCode = 2
    return
  }
  console.error((error as Error).message)
  process.exitCode = 1
})
