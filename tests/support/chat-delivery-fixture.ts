import { ChatDelivery, type ChatDeliveryEnv } from '../../src/chat-delivery-worker/index.ts'
import { deliveryHeaders, DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER } from '../../src/features/chat/lib/delivery-protocol.ts'

/** Storage/Workflow bindings are synthetic; the delivery state machine is real. */
export function chatDeliveryFixture() {
  const values = new Map<string, unknown>()
  const tasks: Promise<unknown>[] = []
  let admissions = 0
  const state = {
    storage: {
      async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined },
      async put(entries: Record<string, unknown>) { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)) },
      async list<T>({ prefix }: { prefix: string }) { return new Map([...values].filter(([key]) => key.startsWith(prefix)).sort().map(([key, value]) => [key, structuredClone(value) as T])) },
      async setAlarm(_time: number) {}, async deleteAll() { values.clear() }, async delete(keys: string[]) { keys.forEach(key => values.delete(key)) },
    },
    waitUntil(task: Promise<unknown>) { tasks.push(task) },
  }
  const identity = { turnId: crypto.randomUUID(), attemptId: crypto.randomUUID(), token: 'a'.repeat(64) }
  const owner = 'synthetic-owner'
  const env: ChatDeliveryEnv = {
    CHAT_DELIVERY_SECRET: 'synthetic-delivery-secret',
    CHAT_EXECUTION: { async fetch() { throw new Error('Fixture must never invoke generation') } },
    CHAT_RESPONSE_WORKFLOW: {
      async create() { admissions++; return {} },
      async get() { return { status: async () => ({ status: 'running' }) } },
    },
    CHAT_DELIVERY: { idFromName: name => name, get: () => ({ fetch: request => object.fetch(request) }) },
  }
  let object = new ChatDelivery(state, env)
  return {
    values, identity, owner, tasks,
    get admissions() { return admissions },
    get object() { return object },
    restart() { object = new ChatDelivery(state, env) },
    request(action: string, options: { owner?: string; token?: string; body?: string } = {}) {
      return new Request(`https://delivery.test/${action}`, {
        method: action === 'stream' ? 'GET' : 'POST',
        headers: { ...deliveryHeaders({ ...identity, token: options.token ?? identity.token }),
          [DELIVERY_TURN_HEADER]: identity.turnId, [DELIVERY_OWNER_HEADER]: options.owner ?? owner },
        ...(action === 'start' ? { body: options.body ?? '{"message":"Synthetic question"}' } : {}),
      })
    },
  }
}
