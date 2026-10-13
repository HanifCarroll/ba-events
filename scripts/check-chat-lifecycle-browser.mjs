import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'
// Bun + installed Chrome. Compiles the real component; all HTTP requests are intercepted.
// UI children/auth/analytics are stubs; the chat SDK and guest IndexedDB store are real.
const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(resolve(tmpdir(), 'ba-events-chat-browser-'))
const { compile, compileModule } = await import(Bun.resolveSync('svelte/compiler', root))
const { chromium } = await import(Bun.resolveSync('playwright', root))
const stubs = {
  auth: 'export const auth = $state({user:null}); export const useAuthContext=()=>auth;',
  messages: 'export const chat_status_preparing=()=>"Preparing", chat_status_thinking=()=>"Thinking", chat_status_persisting=()=>"Saving", chat_status_error=()=>"Error", chat_thinking=()=>"Thinking", chat_conversation_not_found=()=>"Missing", chat_guest_conversation_not_found=()=>"Missing guest", chat_start_new_chat=()=>"New chat", chat_response_stopped=()=>"Response stopped. You can retry this message.", chat_error_generic=()=>"We could not complete the response. Please try again.", chat_retry_needed=()=>"Retry this message to continue.", chat_retry=()=>"Retry", chat_dismiss_notice=()=>"Dismiss notice";',
  locale: 'export const getLocale=()=>"en";',
  analytics: 'export const track=(name,data)=>window.analytics.push({name,data});',
  toast: 'export const toast={error:(...args)=>window.toasts.push(args),warning:(...args)=>window.toasts.push(args)};',
  state: `import {getGuestConversationWithMessages} from '${root}/src/shared/lib/db/guest-conversations.ts';
  export const chatState={getGuestConversation:getGuestConversationWithMessages,addMessage:async()=>({id:'legacy'}),generateTitle:async()=>({title:'Title'}),registerStartNewChatHandler(fn){window.startNew=fn;return()=>{}},getConversationScrollPosition:()=>null,saveConversationScrollPosition:()=>{}};`,
  input: '<script>let {onSend,disabled,onStop,canStop}=$props();let value=$state("")</script><form onsubmit={e=>{e.preventDefault();void onSend(value);value=""}}><input aria-label="Message" bind:value disabled={disabled}/>{#if canStop}<button type="button" onclick={onStop}>Stop response</button>{:else}<button disabled={disabled}>Send</button>{/if}</form>',
  list: '<script>let {messages,isLoading}=$props()</script><div data-testid="messages">{#each messages as message}<p data-role={message.role}>{message.content}</p>{#each message.events??[] as event}<article data-event-id={event.id}>{event.name}</article>{/each}{/each}{#if isLoading}<span>Loading</span>{/if}</div>',
  prompts: '<script>let {onSelectPrompt}=$props()</script><button onclick={()=>onSelectPrompt(window.dogfoodPrompt??"First question")}>Start</button>',
}
await Bun.write(`${temp}/Harness.svelte`, `<script>
import {tick} from 'svelte';
import ChatContainer from '${root}/src/features/chat/components/ChatContainer.svelte';
import {auth} from 'test-auth';
import {bootstrapGuestTurn,claimGuestTurn,completeGuestTurn,getGuestConversationWithMessages} from '${root}/src/shared/lib/db/guest-conversations.ts';
let conversationId=$state(sessionStorage.getItem('browser-conversation'));let preloadedConversation=$state(null);let pendingTurns=$state([]);
window.loadConversation=async(id,preloaded=null,turns=[])=>{conversationId=id;preloadedConversation=preloaded;pendingTurns=turns;await tick()};
window.setUser=async(id)=>{auth.user=id?{id}:null;await tick()};
window.getStored=getGuestConversationWithMessages;
window.completeElsewhere=async(turnId,canonical)=>{const claimId=crypto.randomUUID();await claimGuestTurn(turnId,claimId,true);await completeGuestTurn(turnId,claimId,{canonical,executionTrace:[]})};
window.seed=async(id)=>{await bootstrapGuestTurn({conversationId:id,turnId:crypto.randomUUID(),userClientMessageId:crypto.randomUUID(),assistantClientMessageId:crypto.randomUUID(),content:'Existing question'})};
window.routeId=()=>conversationId;
</script><ChatContainer {conversationId} {preloadedConversation} {pendingTurns} showLanding={true} onConversationChange={async id=>{conversationId=id;sessionStorage.setItem('browser-conversation',id);await tick()}}/>`)
await Bun.write(`${temp}/entry.ts`, `import {mount} from 'svelte';import Harness from './Harness.svelte';window.analytics=[];window.toasts=[];mount(Harness,{target:document.body});`)
const output = await Bun.build({
  entrypoints:[`${temp}/entry.ts`], target:'browser', conditions:['browser','svelte'], minify:false,
  plugins:[{ name:'chat-harness', setup(build) {
    build.onResolve({filter: /^(test-auth|#features\/auth\/hooks\/auth-context\.svelte\.ts)$/},()=>({path:'auth',namespace:'stub'}))
    build.onResolve({filter:/^#features\/chat\/state\/chat\.svelte\.ts$/},()=>({path:'state',namespace:'stub'}))
    build.onResolve({filter:/^#paraglide\/messages\.js$/},()=>({path:'messages',namespace:'stub'}))
    build.onResolve({filter:/^#paraglide\/runtime\.js$/},()=>({path:'locale',namespace:'stub'}))
    build.onResolve({filter:/^#shared\/lib\/analytics\.ts$/},()=>({path:'analytics',namespace:'stub'}))
    build.onResolve({filter:/^svelte-sonner$/},()=>({path:'toast',namespace:'stub'}))
    build.onResolve({filter:/^\.\/(ChatInput|MessageList|SuggestedPrompts)\.svelte$/},args=>({path:args.path.includes('ChatInput')?'input':args.path.includes('MessageList')?'list':'prompts',namespace:'stub'}))
    build.onResolve({filter:/^(svelte(?:\/.*)?|ai|@ai-sdk\/svelte|dexie)$/},args=>({path:args.path==="@ai-sdk/svelte"?root+"/node_modules/@ai-sdk/svelte/dist/index.js":args.path==="svelte"?root+"/node_modules/svelte/src/index-client.js":args.path==="svelte/reactivity"?root+"/node_modules/svelte/src/reactivity/index-client.js":args.path==="svelte/store"?root+"/node_modules/svelte/src/store/index-client.js":Bun.resolveSync(args.path,root)}))
    build.onLoad({filter:/.*/,namespace:'stub'},args=>{
      const text=stubs[args.path];
      const contents=['input','list','prompts'].includes(args.path)?compile(text,{filename:`${temp}/${args.path}.svelte`,generate:'client',runes:true}).js.code:args.path==='auth'?compileModule(text,{filename:`${temp}/auth.svelte.js`,generate:'client'}).js.code:text;
      return {contents,loader:'js',resolveDir:root};
    })
    build.onLoad({filter:/\.svelte$/},async args=>({contents:compile(await Bun.file(args.path).text(),{filename:args.path,generate:'client',runes:true}).js.code,loader:'js',resolveDir:dirname(args.path)}))
    build.onLoad({filter:/\.svelte\.js$/},async args=>({contents:compileModule(await Bun.file(args.path).text(),{filename:args.path,generate:'client'}).js.code,loader:'js',resolveDir:dirname(args.path)}))
  }}]
})
if(!output.success){console.error(output.logs);process.exit(1)}
const script=await output.outputs[0].text();await Bun.write(`${temp}/bundle.js`,script)
const {adaptStoredMessageToCanonical}=await import(`${root}/src/features/chat/lib/canonical.ts`)
const canonical=adaptStoredMessageToCanonical({id:'reply',content:'Verified browser reply'})
const response=(error=false)=>[
{type:'start',messageId:crypto.randomUUID()},
...(error?[{type:'error',errorText:'Simulated failure'}]:[{type:'text-start',id:'text'},{type:'text-delta',id:'text',delta:canonical.text},{type:'text-end',id:'text'},{type:'data-response',data:canonical}]),
{type:'finish',finishReason:error?'error':'stop'}
].map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n'
const browser=await chromium.launch({headless:true,channel:"chrome"})
try {
 const page=await browser.newPage();const errors=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>{console.log('PAGEERROR',String(error));errors.push(String(error))})
 let failNext=false;const requests=[];let holdNext=false;let pendingRoute;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/chat/bootstrap') return route.fulfill({json:{turn:{}}});
  if(/^\/api\/chat\/[^/]+\/stop$/.test(url.pathname)) return route.fulfill({status:204});
  if(url.pathname==='/api/chat') {
   requests.push(route.request().postDataJSON());
   if(holdNext){holdNext=false;pendingRoute=route;return;}
   const error=failNext;failNext=false;
   return route.fulfill({status:200,contentType:'text/event-stream',headers:{'x-vercel-ai-ui-message-stream':'v1'},body:response(error)});
  }
  if(url.pathname==='/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><script>'+script.replaceAll('</script','<\\/script')+'</script></body></html>'});
  await route.abort();
 });
 await page.goto('https://chat-lifecycle.test');
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.getByText('Verified browser reply',{exact:true}).waitFor().catch(async e=>{console.log('BROWSER DIAGNOSTIC',await page.locator('body').innerText(),await page.evaluate(()=>({toasts:window.toasts,analytics:window.analytics,id:window.routeId()})),requests);throw e});
 const initial=await page.evaluate(async()=>({id:window.routeId(),stored:await window.getStored(window.routeId()),analytics:window.analytics}));
 assert.equal(initial.stored.messages.length,2);assert.equal(initial.stored.turns[0].status,'completed');assert.equal(initial.analytics.filter(e=>e.name==='chat:response_received').length,1);
 console.log('PASS browser guest first submission, URL adoption, atomic persistence and visible response');
 holdNext=true;
 await page.getByRole('textbox',{name:'Message'}).fill('Stop this response');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Stop response',exact:true}).waitFor();
 for(let i=0;!pendingRoute&&i<100;i++) await new Promise(r=>setTimeout(r,10));assert.ok(pendingRoute);
 const stoppedRequest=requests.at(-1);
 await page.getByRole('button',{name:'Stop response',exact:true}).click();
 await page.getByRole('status').getByRole('button',{name:'Retry',exact:true}).waitFor();
 await pendingRoute.fulfill({status:200,contentType:'text/event-stream',headers:{'x-vercel-ai-ui-message-stream':'v1'},body:response()}).catch(()=>{});pendingRoute=undefined;
 const stopped=await page.evaluate(async()=>window.getStored(window.routeId()));
 assert.equal(stopped.messages.filter(m=>m.role==='assistant').length,1);assert.equal(stopped.turns.find(t=>t.id===stoppedRequest.turnId).status,'failed');
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-role="assistant"]').length===2);
 assert.equal(requests.at(-1).turnId,stoppedRequest.turnId);assert.equal(requests.at(-1).assistantClientMessageId,stoppedRequest.assistantClientMessageId);
 console.log('PASS browser user stop, late response rejection, accessible retry and stable identifiers');
 await page.evaluate(async()=>{window.startNew();await window.loadConversation(null)});
 requests.length=0;await page.evaluate(()=>{window.analytics=[]});
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.getByText('Verified browser reply',{exact:true}).waitFor();
 failNext=true;
 await page.getByRole('textbox',{name:'Message'}).fill('Second question');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
 const failed=await page.evaluate(async()=>({stored:await window.getStored(window.routeId()),analytics:window.analytics}));
 assert.equal(failed.stored.messages.filter(m=>m.role==='assistant').length,1);assert.equal(failed.analytics.filter(e=>e.name==='chat:response_received').length,1);
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-role="assistant"]').length===2);
 assert.equal(requests[1].turnId,requests[2].turnId);assert.equal(requests[1].assistantClientMessageId,requests[2].assistantClientMessageId);
 console.log('PASS browser error followed by finish, retry visibility, stable turn identifiers and recovery');

 failNext=true;
 await page.getByRole('textbox',{name:'Message'}).fill('Third question');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
 const replayRequest=requests.at(-1);const beforeReplay=requests.length;
 await page.evaluate(async ({turnId,canonical})=>window.completeElsewhere(turnId,canonical),{turnId:replayRequest.turnId,canonical:{...canonical,text:'Completed in another tab'}});
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByText('Completed in another tab',{exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('input').disabled);
 assert.equal(requests.length,beforeReplay);
 console.log('PASS browser completed guest replay renders saved history without a provider request');
 // Authenticated history remains an old snapshot while a new response completes.
 const authId=crypto.randomUUID();await page.evaluate(async id=>{await window.setUser('signed-in');await window.loadConversation(id,{id,user_id:'signed-in',title:'Existing',messages:[{id:'existing',role:'user',content:'Earlier question',visible_content:'Earlier question',created_at:new Date().toISOString()}]})},authId);
 await page.getByRole('textbox',{name:'Message'}).fill('Authenticated question');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Verified browser reply',{exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('input').disabled);
 assert.equal(await page.getByText('Verified browser reply',{exact:true}).count(),1);
 console.log('PASS browser authenticated completion survives the pre-request history snapshot');

 const beforeAccountChange=requests.length;
 await page.evaluate(async id=>{
   await window.setUser('other-account');
   await window.loadConversation(id,{id,user_id:'signed-in',title:'Cached A',messages:[{id:'private',role:'user',content:'Previous account private history',visible_content:'Previous account private history',created_at:new Date().toISOString()}]},[{id:crypto.randomUUID(),status:'pending',content:'Previous account pending turn',user_client_message_id:crypto.randomUUID(),assistant_client_message_id:crypto.randomUUID()}]);
 },authId);
 await page.getByText('Missing',{exact:true}).waitFor();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.getByText('Previous account private history',{exact:true}).count(),0);
 assert.equal(requests.length,beforeAccountChange);
 console.log('PASS browser rejects stale authenticated history and pending turns after an account change');
 await page.evaluate(async id=>window.loadConversation(id,{id,user_id:'other-account',title:'Owned B',messages:[{id:'owned',role:'user',content:'Owned history',visible_content:'Owned history',created_at:new Date().toISOString()}]}),authId);
 holdNext=true;await page.getByRole('textbox',{name:'Message'}).fill('Cancel this request');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('input').disabled);
 for(let i=0;!pendingRoute&&i<100;i++) await new Promise(r=>setTimeout(r,10));assert.ok(pendingRoute);
 await page.evaluate(async()=>{await window.setUser('third-account');await window.loadConversation('new-conversation',{id:'new-conversation',user_id:'third-account',title:'Other',messages:[{id:'other',role:'user',content:'Other account history',visible_content:'Other account history',created_at:new Date().toISOString()}]})});
 await pendingRoute.fulfill({status:200,contentType:'text/event-stream',headers:{'x-vercel-ai-ui-message-stream':'v1'},body:response()}).catch(()=>{});
 await page.getByText('Other account history',{exact:true}).waitFor();
 assert.equal(await page.getByText('Verified browser reply',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Retry',exact:true}).count(),0);
 assert.equal(await page.getByRole('textbox',{name:'Message'}).isEnabled(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS browser account/navigation cancellation cannot overwrite the new view or retry state');
 const { dogfoodChatDelivery } = await import('./dogfood-chat-delivery.mjs');
 await dogfoodChatDelivery({browser,script,temp,root,live:process.argv.includes('--live')});
} finally {await browser.close();await rm(temp,{recursive:true,force:true})}
