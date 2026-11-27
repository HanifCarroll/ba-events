import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type PreviewThread = { ts: string; channel: string; revision: number; instagram: boolean; threads: boolean }
export type DelegatedDecision = { actor: 'hermes'; at: string; reason: string; preview: PreviewThread }

const vetoFile = (stateDir: string, id: string) => join(stateDir, 'vetoes', `${id}.json`)

export function hasDelegatedVeto(stateDir: string, id: string) {
  return statSync(vetoFile(stateDir, id), { throwIfNoEntry: false }) !== undefined
}

/** A veto is permanent. Install the complete receipt once, independently of the tick's draft JSON writes. */
export function recordDelegatedVeto(stateDir: string, id: string, decision: DelegatedDecision) {
  const path = vetoFile(stateDir, id)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify(decision, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  try {
    linkSync(temp, path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    rmSync(temp, { force: true })
  }
}
