/**
 * Portable serialization for resolved absolute filesystem paths.
 *
 * Metadata embedded in committed artifacts must not expose workstation-
 * absolute paths. Runtime reads/writes keep using resolved absolute paths;
 * this helper only converts them to a stable repository-relative POSIX-style
 * string when serializing metadata.
 *
 * Paths under `process.cwd()` become repository-relative POSIX paths (e.g.
 * `evals/search/relevance/capture-latest.json`). Paths outside the repo are
 * replaced with a clear, non-sensitive placeholder so we never assume a
 * repo-relative path for them.
 */

import { basename, isAbsolute, relative, sep } from 'node:path'

export function portablePath(absPath: string): string {
  const rel = relative(process.cwd(), absPath)
  const insideRepo = !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
  if (insideRepo) {
    return rel.split(sep).join('/')
  }
  return `<outside-repo>/${basename(absPath)}`
}
