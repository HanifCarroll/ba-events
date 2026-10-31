import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

// A transport adapter only: the callback runs production handlers. No schema-
// generated responses or duplicate implementation of request validation.
export async function runSchemathesis(createApplication, schemaPath) {
  let application;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(new URL(req.url, origin), {
        method: req.method, headers: req.headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body } : {}),
      });
      const response = await application.handle(request) ?? new Response(null, { status: 404 });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unexpected local harness failure' }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let child;
  const stop = () => { child?.kill('SIGTERM'); server.closeAllConnections(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    application = await createApplication(origin);
    child = spawn('uvx', ['--from', 'schemathesis==4.32.7', 'schemathesis', '--config-file', 'tests/fuzz/schemathesis.toml', 'run', schemaPath,
      '--url', origin, '--phases', 'examples,fuzzing', '--max-examples', '100',
      '--seed', '20261031', '--workers', '1', '--request-timeout', '5',
      '--checks', 'not_a_server_error,status_code_conformance,content_type_conformance,response_headers_conformance,response_schema_conformance',
      '--report', 'junit', '--report-junit-path', 'tmp/fuzz/schemathesis.xml',
      '--generation-database', 'tmp/fuzz/hypothesis',
    ], { stdio: 'inherit', env: { ...process.env, HYPOTHESIS_STORAGE_DIRECTORY: 'tmp/fuzz/hypothesis-storage' } });
    const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Schemathesis failed (${signal ?? code})`)));
      });
    } finally { clearTimeout(timer); }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await application?.close?.();
  }
}
