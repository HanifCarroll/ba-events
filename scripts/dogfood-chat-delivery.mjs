import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'

// Bounded browser fixture, not an application dev server. Browser plugin not available.
// Real Svelte ChatContainer, SDK, IndexedDB and Cloudflare SQLite Durable Object.
export async function dogfoodChatDelivery({ browser, script, temp, root, live }) {
 const { Miniflare, convertV4MiniflareOptions } = await import(Bun.resolveSync('miniflare', `${root}/node_modules/wrangler`));
 process.env.MINIFLARE_WORKERD_PATH ??= (await import(Bun.resolveSync('workerd', root))).default;
 const { adaptStoredMessageToCanonical } = await import(`${root}/src/features/chat/lib/canonical.ts`);
 const { createUIMessageStream, createUIMessageStreamResponse } = await import(Bun.resolveSync('ai', root));
 const { POST: startDelivery } = await import(`${root}/src/routes/api/chat/+server.ts`);
 const { GET: attachDelivery } = await import(`${root}/src/routes/api/chat/[turnId]/stream/+server.ts`);
 const { POST: stopDelivery } = await import(`${root}/src/routes/api/chat/[turnId]/stop/+server.ts`);
 const { POST: executeDelivery } = await import(`${root}/src/routes/api/chat/execute/+server.ts`);
 const { ChatEventDecoder, eventData } = await import(`${root}/src/features/chat/lib/delivery-protocol.ts`);
 const secret = crypto.randomUUID() + crypto.randomUUID();
 const { workflowRequest } = await import(`${root}/src/chat-delivery-worker/recovery.ts`);
 const { saveChatDeliveryCheckpoint, getChatDeliveryCheckpoint, beginChatDeliveryCommit } = await import(`${root}/src/features/chat/api/delivery.server.ts`);
 const entry = `${temp}/delivery-worker.ts`;
 await Bun.write(entry, `export { ChatResponseWorkflow } from '${root}/src/chat-delivery-worker/workflow.ts';\n export { ChatDelivery } from '${root}/src/chat-delivery-worker/index.ts';
 export default { fetch(request,env){const name=new URL(request.url).searchParams.get('name')??(request.headers.get('x-chat-turn')+':'+request.headers.get('x-chat-attempt'));return env.CHAT_DELIVERY.get(env.CHAT_DELIVERY.idFromName(name)).fetch(request)} };`);
 const bundle = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm', minify: true, external: ['cloudflare:workers'] });
 assert.equal(bundle.success, true, JSON.stringify(bundle.logs));
 let mf; let production; let executions = 0; let commitCalls = 0; let holdCommitOnce = false; let releaseHeldCommit; let mode = 'fixture'; let release; let cutNext = false; let resumes = [];
 const observed = [];
 const namespace = { idFromName: name => name, get: () => ({ async fetch(request) {
  return mf.dispatchFetch(request.url, { method: request.method, headers: request.headers,
   ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.text() } : {}) });
 } }) };
 const event = request => ({ request, url: new URL(request.url), params: {},
  platform: { env: { CHAT_DELIVERY: namespace, CHAT_DELIVERY_SECRET: secret } },
  cookies: { getAll: () => [], get: () => undefined, set: () => {} }, locals: {},
  getClientAddress: () => '127.0.0.1', isDataRequest: false, isSubRequest: false });
 async function execution(request) {
  const stage = request.headers.get('x-chat-execution-stage'); if(stage === 'generate') executions++;
  if (mode === 'unrecoverable' && stage === 'generate') throw new Error('Fixture generation unavailable');
  if (stage === 'fail' && mode !== 'live' && mode !== 'production') return new Response(null, { status: 204 });
  const nativeRequest = new Request(request.url, { method: 'POST', headers: request.headers, body: await request.text(), signal: request.signal });
  if (mode === 'live') return executeDelivery(event(nativeRequest));
  if (mode === 'production') return productionResponse(nativeRequest);
  const body = await nativeRequest.clone().json();
  const canonical = { ...adaptStoredMessageToCanonical({ id: body.assistantClientMessageId, content: 'Completed after replay' }),
   requestId: nativeRequest.headers.get('x-chat-attempt') };
  if(stage === 'commit') { commitCalls++; const checkpoint = await getChatDeliveryCheckpoint(event(nativeRequest)); await beginChatDeliveryCommit(event(nativeRequest)); if(holdCommitOnce){holdCommitOnce=false;await new Promise(resolve=>{releaseHeldCommit=resolve})} return createUIMessageStreamResponse({stream:createUIMessageStream({execute:({writer})=>{writer.write({type:'start',messageId:body.assistantClientMessageId});writer.write({type:'data-response',data:checkpoint.canonical});writer.write({type:'finish',finishReason:'stop'})}})}) }
  const gate = new Promise(resolve => { release = resolve });
  return createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: async ({ writer }) => {
   writer.write({ type: 'start', messageId: body.assistantClientMessageId });
   writer.write({ type: 'data-progress', transient: true, data: { ...canonical, text: 'Server-validated preview' } });
   await gate;
   await saveChatDeliveryCheckpoint(event(nativeRequest),{canonical,executionTrace:[]});
  } }) });
 }
 // Copy service callback responses into Miniflare's Response implementation.
 const { Response: RuntimeResponse } = await import(Bun.resolveSync('miniflare', `${root}/node_modules/wrangler`));
 mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: await bundle.outputs[0].text(),
  compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { CHAT_DELIVERY: { className: 'ChatDelivery', useSQLite: true } },
  workflows: { CHAT_RESPONSE_WORKFLOW: { name: 'fixture-chat-response', className: 'ChatResponseWorkflow' } },
  bindings: { CHAT_DELIVERY_SECRET: secret,
   ...(process.env.CHAT_DOGFOOD_EARLY_GENERATION === '1' ? { CHAT_EXPERIMENTAL_EARLY_GENERATION: 'after-admission' } : {}) },
  serviceBindings: { CHAT_EXECUTION: async request => {
   const result = await execution(request);
   if (!result.body) return new RuntimeResponse(null, { status: result.status, headers: result.headers });
   const reader = result.body.getReader(); const decoder = new TextDecoder(); const events = new ChatEventDecoder();
   return new RuntimeResponse(new ReadableStream({ async pull(controller) {
    const { done, value } = await reader.read(); if (done) { controller.close(); return }
    for (const frame of events.push(decoder.decode(value, { stream: true }))) {
     const data = eventData(frame); if (!data || data === '[DONE]') continue;
     const chunk = JSON.parse(data);
     if (chunk.type === 'data-progress' || chunk.type === 'data-progress-text' || chunk.type === 'data-response' || chunk.type === 'finish') {
      observed.push({ type: chunk.type, time: Date.now(), text: chunk.data?.text, ids: chunk.data?.events?.map(event => event.id), names: chunk.data?.events?.map(event => event.name), fallback: chunk.data?.provenance?.fallbackUsed });
     }
    }
    controller.enqueue(value);
   }, cancel: () => reader.cancel() }), { status: result.status, headers: result.headers });
  } } }));
 async function productionResponse(request) {
  const url = new URL(request.url);
  if (request.method === 'GET' && (url.pathname.startsWith('/_app/') || /\.(?:png|jpg|jpeg|ico|svg|webp|css|js|json)$/.test(url.pathname))) {
   const file = Bun.file(resolve(root, '.svelte-kit/cloudflare', `.${url.pathname}`));
   if (await file.exists()) return new Response(file);
  }
  // Local production fixture preserves the app's canonical HTTPS origin and CSRF rules.
  url.protocol = 'https:'; url.hostname = 'baeventos.com'; url.port = '';
  const headers = new Headers(request.headers); headers.set('host', 'baeventos.com');
  if (headers.has('origin')) headers.set('origin', 'https://baeventos.com');
  return production.respond(new Request(url, { method: request.method, headers, signal: request.signal,
   ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.text() } : {}) }), {
   platform: { env: { CHAT_DELIVERY: namespace, CHAT_DELIVERY_SECRET: secret } }, getClientAddress: () => '127.0.0.1',
  });
 }
 const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 120, async fetch(request) {
  if (mode === 'production') return productionResponse(request);
  const url = new URL(request.url);
  if (url.pathname === '/') return new Response(`<!doctype html><html><head><title>Chat delivery dogfood</title></head><body><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`, { headers: { 'content-type': 'text/html' } });
  if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
  if (url.pathname === '/api/chat') {
   const result = await startDelivery(event(request));
   if (!cutNext || !result.body) return result;
   cutNext = false;
   const reader = result.body.getReader(); const events = new ChatEventDecoder(); const decoder = new TextDecoder();
   return new Response(new ReadableStream({ async pull(controller) {
    const { done, value } = await reader.read(); if (done) { controller.close(); return }
    controller.enqueue(value);
    if (events.push(decoder.decode(value, { stream: true })).some(frame => eventData(frame)?.includes('"type":"data-progress"'))) {
     await reader.cancel(); controller.close();
    }
   }, cancel: () => reader.cancel() }), { status: result.status, headers: result.headers });
  }
  const match = url.pathname.match(/^\/api\/chat\/([^/]+)\/(stream|stop)$/);
  if (match) { const e = event(request); e.params.turnId = match[1];
   if (match[2] === 'stream') { resumes.push(url.searchParams.get('after')); return attachDelivery(e) }
   return stopDelivery(e);
  }
  return new Response(null, { status: 404 });
 } });
 const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
 const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(String(error)));
 page.setDefaultTimeout(15_000);
 const url = `http://127.0.0.1:${server.port}/`;
 try {
  await mf.ready; await page.goto(url); assert.equal(await page.title(), 'Chat delivery dogfood');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByText('Server-validated preview', { exact: true }).waitFor();
  let stored = await page.evaluate(() => window.getStored(window.routeId()));
  assert.equal(stored.messages.filter(message => message.role === 'assistant').length, 0);
  await page.reload(); await page.getByText('Server-validated preview', { exact: true }).waitFor();
  assert.equal(executions, 1); assert.ok(resumes.includes('-1'));
  release(); await page.getByText('Completed after replay', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('input').disabled);
  stored = await page.evaluate(() => window.getStored(window.routeId()));
  assert.equal(stored.messages.filter(message => message.role === 'assistant').length, 1);
  console.log('PASS Cloudflare SQLite delivery: preview before persistence, refresh replay, one provider execution and one guest completion');
  cutNext = true; resumes = [];
  await page.getByRole('textbox', { name: 'Message' }).fill('Reconnect this attempt'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Server-validated preview', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-role="assistant"]').length === 2);
  for (let i = 0; !resumes.length && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(Number(resumes.at(-1)) >= 1); assert.equal(executions, 2);
  release(); await page.waitForFunction(() => !document.querySelector('input').disabled);
  stored = await page.evaluate(() => window.getStored(window.routeId()));
  assert.equal(stored.messages.filter(message => message.role === 'assistant').length, 2);
  console.log('PASS Cloudflare delivery: mid-stream connection loss resumes from its cursor without duplicate generation or guest writes');
  await page.getByRole('textbox', { name: 'Message' }).fill('Leave and return'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Server-validated preview', { exact: true }).waitFor();
  const conversationId = await page.evaluate(() => window.routeId());
  await page.evaluate(() => window.loadConversation(null));
  stored = await page.evaluate(id => window.getStored(id), conversationId);
  assert.equal(stored.turns.find(turn => turn.content === 'Leave and return').status, 'running');
  await page.evaluate(id => window.loadConversation(id), conversationId); await page.getByText('Server-validated preview', { exact: true }).waitFor();
  assert.equal(executions, 3); release(); await page.waitForFunction(() => !document.querySelector('input').disabled);
  stored = await page.evaluate(() => window.getStored(window.routeId()));
  assert.equal(stored.messages.filter(message => message.role === 'assistant').length, 3);
  console.log('PASS Cloudflare delivery: navigation detaches without releasing the guest claim, and returning resumes the original attempt');
  await page.getByRole('textbox', { name: 'Message' }).fill('Stop this attempt'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Server-validated preview', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await page.getByRole('status').getByRole('button', { name: 'Retry', exact: true }).waitFor(); release();
  stored = await page.evaluate(() => window.getStored(window.routeId()));
  assert.equal(stored.messages.filter(message => message.role === 'assistant').length, 3);
  assert.equal(stored.turns.find(turn => turn.content === 'Stop this attempt').status, 'failed');
  console.log('PASS Cloudflare delivery: explicit Stop prevents final publication and leaves an accessible retry');
  for (const recoveryStage of ['generate','commit']) {
   const before=executions; const beforeCommit=commitCalls;
   if(recoveryStage==='commit')holdCommitOnce=true;
   await page.evaluate(async stage=>{window.startNew();sessionStorage.removeItem('browser-conversation');await window.loadConversation(null);window.dogfoodPrompt='Recover after '+stage},recoveryStage);await page.getByRole('button',{name:'Start',exact:true}).click();
   await page.getByText('Server-validated preview',{exact:true}).last().waitFor();
   stored=await page.evaluate(()=>window.getStored(window.routeId()));const turn=stored.turns.at(-1);const name=turn.id+':'+turn.claim_id;
   if(recoveryStage==='commit'){release();for(let i=0;commitCalls===beforeCommit&&i<1000;i++)await new Promise(r=>setTimeout(r,10));assert.equal(commitCalls,beforeCommit+1)}
   const interrupted=await namespace.get().fetch(await workflowRequest(secret,name,'interrupt')).catch(()=>null);assert.ok(!interrupted||interrupted.status>=500);
   if(recoveryStage==='generate'){for(let i=0;executions<before+2&&i<1000;i++)await new Promise(r=>setTimeout(r,10));assert.equal(executions,before+2);release()}
   await page.waitForFunction(()=>!document.querySelector('input').disabled,{timeout:20_000});
   releaseHeldCommit?.();releaseHeldCommit=undefined;
   stored=await page.evaluate(()=>window.getStored(window.routeId()));assert.equal(stored.turns.at(-1).status,'completed');assert.equal(stored.messages.filter(m=>m.role==='assistant'&&m.client_message_id===turn.assistant_client_message_id).length,1);
   if(recoveryStage==='commit'){assert.equal(executions,before+1);assert.equal(commitCalls,beforeCommit+2)}
   console.log('PASS real workflow recovery after native Durable Object reset during '+recoveryStage+': original turn, one canonical completion, fenced restart and checkpoint reuse');
  }
  mode = 'unrecoverable'; const beforeFailure = executions;
  await page.evaluate(async () => { window.startNew(); sessionStorage.removeItem('browser-conversation'); await window.loadConversation(null); window.dogfoodPrompt = 'Retry after recovery is exhausted' });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const failureNotice = page.getByRole('alert');
  await failureNotice.getByRole('button', { name: 'Retry', exact: true }).waitFor({ timeout: 20_000 });
  assert.match(await failureNotice.innerText(), /could not finish/i);
  if (process.env.CHAT_DOGFOOD_EVIDENCE_DIR) {
   await mkdir(process.env.CHAT_DOGFOOD_EVIDENCE_DIR, { recursive: true });
   await page.screenshot({ path: resolve(process.env.CHAT_DOGFOOD_EVIDENCE_DIR, 'exhausted-recovery-retry.png'), fullPage: true });
  }
  stored = await page.evaluate(() => window.getStored(window.routeId())); const failedTurn = stored.turns.at(-1);
  assert.equal(executions, beforeFailure + 3);
  assert.equal(failedTurn.status, 'failed'); assert.equal(stored.messages.length, 1);
  mode = 'fixture';
  await failureNotice.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('Server-validated preview', { exact: true }).waitFor(); release();
  await page.waitForFunction(() => !document.querySelector('input').disabled);
  stored = await page.evaluate(() => window.getStored(window.routeId())); const retriedTurn = stored.turns.at(-1);
  assert.equal(stored.turns.length, 1); assert.equal(stored.messages.length, 2);
  assert.equal(retriedTurn.id, failedTurn.id); assert.equal(retriedTurn.status, 'completed');
  assert.equal(retriedTurn.user_client_message_id, failedTurn.user_client_message_id);
  assert.equal(retriedTurn.assistant_client_message_id, failedTurn.assistant_client_message_id);
  assert.notEqual(retriedTurn.claim_id, failedTurn.claim_id);
  assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
  console.log('PASS exhausted workflow recovery: clear alert and Retry, same question and message identifiers, fresh attempt and exactly one response');
  if (live) {
   assert.ok(process.env.DEEPSEEK_API_KEY && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY, 'Live dogfood needs configured model and database credentials');
   mode = 'live'; observed.length = 0;
   await page.evaluate(async () => { window.startNew(); sessionStorage.removeItem('browser-conversation'); await window.loadConversation(null); window.dogfoodPrompt = 'Qué eventos hay esta semana en Buenos Aires?' });
   const liveStarted = Date.now(); await page.getByRole('button', { name: 'Start', exact: true }).click();
   await page.waitForFunction(() => document.querySelectorAll('[data-event-id]').length > 0, { timeout: 90_000 });
   const previewAt = Date.now();
   await page.waitForFunction(() => !document.querySelector('input').disabled, { timeout: 90_000 });
   stored = await page.evaluate(() => window.getStored(window.routeId()));
   assert.equal(stored.turns.at(-1).status, 'completed'); assert.equal(stored.messages.filter(message => message.role === 'assistant').length, 1);
   const completed = observed.find(item => item.type === 'data-response');
   assert.ok(completed && completed.ids.length > 0 && completed.fallback === false);
   const firstPreview = observed.find(item => item.type === 'data-progress' && item.ids?.length);
   assert.ok(firstPreview && firstPreview.time < completed.time);
   assert.equal(observed.filter(item => item.type === 'data-response').length, 1);
   const evidence = resolve(process.env.CHAT_DOGFOOD_EVIDENCE_DIR ?? '/tmp/ba-events-chat-dogfood'); await mkdir(evidence, { recursive: true });
   await page.screenshot({ path: `${evidence}/desktop.png`, fullPage: true });
   await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${evidence}/mobile.png`, fullPage: true });
   await Bun.write(`${evidence}/result.json`, JSON.stringify({ environment: 'Compiled ChatContainer + real SDK/IndexedDB + workerd SQLite DO + live DeepSeek/search; child rendering stubs',
    conversationId: stored.conversation.id, firstCardsMs: previewAt - liveStarted, finalMs: completed.time - liveStarted,
    previewLeadMs: completed.time - firstPreview.time, cards: completed.ids.length, canonicalResponses: 1, fallbackUsed: false, browserErrors: errors }, null, 2));
   console.log(`PASS live model/search dogfood: ${completed.ids.length} server-derived cards appeared ${completed.time - firstPreview.time}ms before final commit; exactly one canonical response. Evidence: ${evidence}`);
   if (process.argv.includes('--production')) {
    const { Server } = await import(`${root}/.svelte-kit/output/server/index.js`);
    const { manifest } = await import(`${root}/.svelte-kit/output/server/manifest.js`);
    production = new Server(manifest); await production.init({ env: process.env });
    mode = 'production'; observed.length = 0;
    const appContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const appPage = await appContext.newPage(); const appErrors = [];
    appPage.on('pageerror', error => appErrors.push(String(error))); appPage.setDefaultTimeout(20_000);
    try {
     await appPage.goto(url); await appPage.getByRole('textbox').first().fill('Qué eventos hay esta semana en Buenos Aires?');
     const before = executions; await appPage.getByRole('textbox').first().press('Enter');
     for (let i = 0; !observed.some(item => item.type === 'data-progress' && item.ids?.length) && i < 900; i++) await new Promise(resolve => setTimeout(resolve, 100));
     const preview = observed.find(item => item.type === 'data-progress' && item.ids?.length); assert.ok(preview, 'Live production build must produce event previews');
     await appPage.getByText(preview.names[0], { exact: true }).filter({ visible: true }).first().waitFor();
     await appPage.screenshot({ path: `${evidence}/production-progress.png`, fullPage: true });
     await appPage.reload();
     await appPage.getByText(preview.names[0], { exact: true }).filter({ visible: true }).first().waitFor();
     await appPage.waitForFunction(() => document.querySelector('textarea') && !document.querySelector('textarea').disabled, { timeout: 90_000 });
     assert.equal(executions, before + 1); assert.equal(observed.filter(item => item.type === 'data-response').length, 1);
     assert.equal(observed.find(item => item.type === 'data-response').fallback, false);
     assert.deepEqual(appErrors, []);
     await appPage.screenshot({ path: `${evidence}/production-desktop.png`, fullPage: true });
     await appPage.setViewportSize({ width: 390, height: 844 }); await appPage.screenshot({ path: `${evidence}/production-mobile.png`, fullPage: true });
     await Bun.write(`${evidence}/production-result.json`, JSON.stringify({ environment: 'Actual production SvelteKit build, real UI, real SDK/IndexedDB, workerd SQLite delivery, live DeepSeek/search', previewLeadMs: observed.find(item => item.type === 'data-response').time - preview.time,
      executions: executions - before, canonicalResponses: 1, fallbackUsed: false, browserErrors: appErrors }, null, 2));
     console.log('PASS actual production UI dogfood: live event previews, page refresh reconnect, single execution, completed cards and desktop/mobile screenshots');
    } catch (error) {
     await appPage.screenshot({ path: `${evidence}/production-failure.png`, fullPage: true });
     await Bun.write(`${evidence}/production-failure.txt`, `${appPage.url()}\n${await appPage.locator('body').innerText()}\n${JSON.stringify(appErrors)}`);
     throw error;
    } finally { await appContext.close() }
   }
  }
  assert.deepEqual(errors, []);
 } finally { await context.close(); server.stop(true); await mf.dispose() }
}
