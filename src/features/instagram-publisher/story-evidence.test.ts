import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { saveComposerEvidence } from './story-evidence.ts'

it('saves the failed step, redacted URL, and screenshot under the given evidence directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-evidence-'))
  try {
    const url = 'https://business.facebook.com/login?next=SECRET#SECRET'
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const dir = saveComposerEvidence(root, 'open the composer', url, `Could not navigate to ${url}`, image.toString('base64'))
    expect(dir.startsWith(join(root, 'composer-failure-'))).toBe(true)
    expect(readFileSync(join(dir, 'screenshot.jpg'))).toEqual(image)
    expect(JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8'))).toEqual({
      step: 'open the composer',
      url: 'https://business.facebook.com/login',
      reason: 'Could not navigate to https://business.facebook.com/login',
      screenshot: 'screenshot.jpg',
    })
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('still records the failure when the tunnel never gave us a tab', () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-evidence-'))
  try {
    const dir = saveComposerEvidence(root, 'reach the Pro agent browser', '', 'tunnel timed out')
    expect(existsSync(join(dir, 'screenshot.jpg'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'failure.json'), 'utf8'))).toEqual({
      step: 'reach the Pro agent browser', url: null, reason: 'tunnel timed out', screenshot: null,
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
