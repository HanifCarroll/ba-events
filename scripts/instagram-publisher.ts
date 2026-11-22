/**
 * BA Eventos Instagram publisher (VPS). Drafts the Hoy, Este finde, Gratis, and Este finde Reel posts from the catalog, previews them
 * in Slack #ba-eventos, and publishes approved drafts. See docs/instagram-publisher.md.
 *
 *   tick                                             do whatever is due (the systemd timer runs this every 10 minutes)
 *   dry-run <hoy|finde|gratis|reel> --date <YYYY-MM-DD> --out <dir> [--track <id>] [--threads]  render a draft without publishing
 *   threads-report [--days 28]                       read Threads insights for posts from this publisher
 *   stickers-dry-run <hoy draft id> --out <dir>       capture every Instagram preview and discard without sharing
 *   regenerate <draft id> [--exclude <event id> ...] [--track <id>]  rebuild a draft (a Reel may switch track) and preview it again
 *   status                                           list the drafts, their state, and their times
 */
import { isFormatKey } from '../src/features/instagram-publisher/formats.ts'
import { Job, dryRun, liveServices, regenerate, status, stickersDryRun, tick } from '../src/features/instagram-publisher/job.ts'
import { renderFramesInProcess } from '../src/features/instagram-publisher/runtime.ts'
import { threadsApi } from '../src/features/instagram-publisher/threads-api.ts'
import { threadsReport } from '../src/features/instagram-publisher/threads-report.ts'
import { readThreadsToken } from '../src/features/instagram-publisher/threads-token.ts'

const USAGE = 'usage: instagram-publisher.ts tick | status | dry-run <hoy|finde|gratis|reel> --date <YYYY-MM-DD> --out <dir> [--track <id>] [--threads] | threads-report [--days 28] | regenerate <draft id> [--exclude <event id> ...] [--track <id>] | stickers-dry-run <hoy draft id> --out <dir>'

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
  console.error((error as Error).message)
  process.exitCode = 1
})
