// Narrow declarations for native Cloudflare roots in the app's DOM-oriented TS project.
// Runtime exports and their behavior are verified by Wrangler/workerd, not implemented here.
declare module 'cloudflare:workers' {
 export class WorkflowEntrypoint<Env = unknown, Params = unknown> { protected readonly env: Env }
 export class WorkerEntrypoint<Env = unknown> { protected readonly env: Env }
 export interface WorkflowEvent<Params> { payload: Readonly<Params>; instanceId: string }
 export interface WorkflowStep {
  do<T>(name: string, config: { retries: { limit: number; delay: string; backoff: 'constant' }; timeout: string }, callback: (context: { attempt: number }) => Promise<T>): Promise<T>
 }
}
