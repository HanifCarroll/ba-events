import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export type ReadD1 = <T>(sql: string, params?: readonly (string | number)[]) => Promise<T[]>

/** Operator reads use the SELECT-only helper. Values reach D1 as bind parameters. */
export function readD1(staging: boolean): ReadD1 {
  return async <T>(sql: string, params: readonly (string | number)[] = []) => {
    const { stdout } = await promisify(execFile)(fileURLToPath(new URL('../bin/ba-d1-read.sh', import.meta.url)),
      [...(staging ? ['--staging'] : []), sql, JSON.stringify(params)], { timeout: 100_000, maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout) as T[]
  }
}
