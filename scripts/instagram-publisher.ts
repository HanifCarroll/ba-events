/**
 * BA Eventos Instagram publisher (VPS). Drafts the Hoy, Este finde, and Gratis posts from the catalog, previews them
 * in Slack #ba-eventos, and publishes approved drafts through the Instagram API. See docs/instagram-publisher.md.
 *
 *   tick                                             do whatever is due (the systemd timer runs this every 10 minutes)
 *   dry-run <hoy|finde|gratis> --date <YYYY-MM-DD> --out <dir>   render a real draft; no Slack, R2, or Instagram
 *   regenerate <draft id> --exclude <event id> [...]  rebuild a draft without an event and preview it again
 *   status                                           list the drafts, their state, and their times
 */
import { isFormatKey } from '../src/features/instagram-publisher/formats.ts'
import { dryRun, regenerate, status, tick } from '../src/features/instagram-publisher/job.ts'
import { renderFramesInProcess } from '../src/features/instagram-publisher/runtime.ts'

const USAGE = 'usage: instagram-publisher.ts tick | status | dry-run <hoy|finde|gratis> --date <YYYY-MM-DD> --out <dir> | regenerate <draft id> --exclude <event id> [--exclude <event id>]'

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
      if (!format || !isFormatKey(format) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !out) throw new Error(USAGE)
      return dryRun(format, date, out)
    }
    case 'regenerate': {
      const [id] = args
      const exclude = flags(args, 'exclude')
      if (!id || !exclude.length) throw new Error(USAGE)
      return regenerate(id, exclude)
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
