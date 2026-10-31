import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
// Child tools receive only runtime settings, never provider/database credentials.
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'SYSTEMROOT', 'CI', 'FC_SEED'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, stdio: 'inherit' });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code})`));
  });
});
const mode = process.argv[2];
const extra = process.argv.slice(3);
mkdirSync('tmp/fuzz/corpus', { recursive: true });
mkdirSync('tmp/fuzz/artifacts', { recursive: true });
if (mode === 'jazzer') {
  await run('bun', ['--no-env-file', 'build', 'tests/fuzz/target.ts', '--target=node', '--format=esm', '--packages=external', '--outfile=tmp/fuzz/target.mjs']);
  await run('node', ['node_modules/@jazzer.js/core/dist/cli.js', 'tmp/fuzz/target.mjs',
    'tmp/fuzz/corpus', 'tests/fuzz/corpus', '--sync', '--',
    '-runs=10000', '-seed=20261031', '-max_len=4096', '-timeout=5',
    '-artifact_prefix=tmp/fuzz/artifacts/', ...extra]);
} else if (mode === 'search') {
  if (extra.length) throw new Error('Search property tests accept no extra arguments.');
  await run('bun', ['--no-env-file', 'tests/fuzz/search-properties.ts']);
} else if (mode === 'api') {
  if (extra.length) throw new Error('API fuzzing accepts no remote URL or extra arguments. Edit the local fixture and schema to extend coverage.');
  await run('bun', ['--no-env-file', 'tests/fuzz/api.ts']);
} else {
  throw new Error('Use jazzer, api or search.');
}
