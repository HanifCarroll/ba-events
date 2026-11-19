import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function safeUrl(raw: string) {
  try {
    const url = new URL(raw)
    return url.origin === 'null' ? url.protocol : `${url.origin}${url.pathname}`
  } catch { return null }
}

/** Keep screenshots and diagnostic URLs out of Slack and Git. Only share the private directory path. */
export function saveComposerEvidence(root: string, step: string, url: string, reason: string, image?: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const dir = mkdtempSync(join(root, 'composer-failure-'))
  const screenshot = 'screenshot.jpg'
  if (image) writeFileSync(join(dir, screenshot), Buffer.from(image, 'base64'), { mode: 0o600 })
  writeFileSync(join(dir, 'failure.json'), `${JSON.stringify({
    step, url: safeUrl(url),
    reason: reason.split(/\r?\n/, 1)[0]?.replace(/https?:\/\/[^\s'"<>)]+/g, match => safeUrl(match) ?? '[URL]').slice(0, 500),
    screenshot: image ? screenshot : null,
  }, null, 2)}\n`, { mode: 0o600 })
  return dir
}
