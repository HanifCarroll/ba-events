import { WorkflowEntrypoint, WorkerEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type { ChatDeliveryEnv } from './index.ts'
import { workflowRequest, type ExecutionStage } from './recovery.ts'

export type ChatWorkflowParams = { name: string }
const generationPolicy = { retries: { limit: 2, delay: '1 second', backoff: 'constant' as const }, timeout: '95 seconds' }
const commitPolicy = { retries: { limit: 3, delay: '1 second', backoff: 'constant' as const }, timeout: '20 seconds' }
async function call(env: ChatDeliveryEnv, name: string, action: string, stage?: ExecutionStage) {
 const stub = env.CHAT_DELIVERY.get(env.CHAT_DELIVERY.idFromName(name))
 const response = await stub.fetch(await workflowRequest(env.CHAT_DELIVERY_SECRET, name, action, stage))
 if (!response.ok) throw new Error('Chat workflow delivery unavailable')
 return await response.json() as { phase: string; fence: number }
}
/** Generation and authoritative publication are separately checkpointed, idempotent stages. */
export class ChatResponseWorkflow extends WorkflowEntrypoint<ChatDeliveryEnv, ChatWorkflowParams> {
 async run(event: WorkflowEvent<ChatWorkflowParams>, step: WorkflowStep) {
  const name = event.payload.name
  try {
   const generated = await step.do('generate validated response', generationPolicy, () => call(this.env, name, 'run', 'generate'))
   if (generated.phase !== 'running') return generated
   return await step.do('commit and publish validated response', commitPolicy, () => call(this.env, name, 'run', 'commit'))
  } catch {
   return await step.do('close exhausted recovery', commitPolicy, () => call(this.env, name, 'workflow-fail'))
  }
 }
}
/** Operator access is binding-only. Live dogfood can reset its own object without a public chaos endpoint. */
export class ChatRecoveryAdmin extends WorkerEntrypoint<ChatDeliveryEnv> {
 async inspect(name: string) { return call(this.env, name, 'inspect') }
 async interrupt(name: string) { return call(this.env, name, 'interrupt') }
}
