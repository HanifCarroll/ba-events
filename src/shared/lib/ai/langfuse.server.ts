import type { TelemetryOptions } from 'ai'
import { redactingSpanProcessor } from './trace-redaction.ts'
import type { ChatTiming } from '#features/chat/lib/timing.ts'

export interface ConciergeTraceContext {
  requestId?: string
  sessionId?: string
  channel?: 'web' | 'telegram' | 'eval'
  promptVersion?: string
  configurationId?: string
  retainTask?: (task: Promise<unknown>) => void
  timing?: ChatTiming
}

type Runtime = {
  integration: import('@langfuse/vercel-ai-sdk').LangfuseVercelAiSdkIntegration
  processor: import('@langfuse/otel').LangfuseSpanProcessor
  tracing: typeof import('@langfuse/tracing')
}

let runtime: Promise<Runtime> | undefined

export function langfuseConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)
}

/** Lazy SDK boundary: no credentials means no exporter, timers, or network traffic. */
export async function initializeLangfuse(): Promise<Runtime | undefined> {
  if (!langfuseConfigured() || process.env.LANGFUSE_TRACING_ENABLED === 'false') return undefined
  runtime ??= (async () => {
    const [{ context, trace }, { BasicTracerProvider }, { AsyncLocalStorageContextManager },
      { LangfuseSpanProcessor }, { LangfuseVercelAiSdkIntegration }, tracing] = await Promise.all([
      import('@opentelemetry/api'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/context-async-hooks'),
      import('@langfuse/otel'),
      import('@langfuse/vercel-ai-sdk'),
      import('@langfuse/tracing'),
    ])
    const processor = new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com',
      environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? 'development',
      release: process.env.LANGFUSE_RELEASE,
      timeout: 2,
      mediaUploadEnabled: false,
      additionalHeaders: { 'x-langfuse-ingestion-version': '4' },
      // Explicitly flush at the request/CLI boundary; do not rely on an idle Worker timer.
      flushInterval: 60,
    })
    const provider = new BasicTracerProvider({ spanProcessors: [redactingSpanProcessor(processor)] })
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
    trace.setGlobalTracerProvider(provider)
    return { processor, tracing, integration: new LangfuseVercelAiSdkIntegration() }
  })()
  try { return await runtime }
  catch {
    runtime = undefined
    console.warn('[langfuse] tracing initialization failed')
    return undefined
  }
}

export async function flushLangfuse(): Promise<void> {
  if (!runtime) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      (await runtime).processor.forceFlush(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Trace export timed out')), 3_000)
      }),
    ])
  }
  catch { console.warn('[langfuse] trace export failed') }
  finally { if (timer) clearTimeout(timer) }
}

/** AI SDK leaf; observability never retries or changes the application result. */
export function traceConcierge<T extends { text: string; steps: unknown[] }>(
  input: ConciergeTraceContext & { messages: unknown[] },
  run: (telemetry?: TelemetryOptions) => Promise<T>,
): Promise<T> {
  const execution = traceConciergeRun(input, run)
  // Effect interruption can finish before this Promise's trace flush finishes.
  try { input.retainTask?.(execution.then(() => undefined, () => undefined)) }
  catch { console.warn('[langfuse] cleanup retention failed') }
  return execution
}

async function traceConciergeRun<T extends { text: string; steps: unknown[] }>(
  input: ConciergeTraceContext & { messages: unknown[] },
  run: (telemetry?: TelemetryOptions) => Promise<T>,
): Promise<T> {
  const sdk = await initializeLangfuse()
  if (!sdk) return run()
  const { startActiveObservation, propagateAttributes } = sdk.tracing
  let started = false
  let completed: T | undefined
  try {
    return await propagateAttributes({
      sessionId: input.sessionId,
      tags: ['concierge', input.channel ?? 'web'],
      metadata: {
        requestId: input.requestId ?? 'unknown', channel: input.channel ?? 'web',
        promptVersion: input.promptVersion ?? 'unrecorded',
        configurationId: input.configurationId ?? 'unrecorded',
      },
    }, () => startActiveObservation('ba-eventos.concierge', async (span) => {
      span.update({ input: input.messages })
      started = true
      const result = await run({ functionId: 'ba-eventos.concierge', integrations: [sdk.integration] })
      completed = result
      span.update({ output: result.text, metadata: { modelStepCount: result.steps.length } })
      return result
    }, { asType: 'agent' }))
  } catch (error) {
    // Never repeat a model run to recover telemetry. If instrumentation failed
    // before execution, run once without it; preserve any completed result.
    if (!started) return run()
    if (completed) return completed
    throw error
  } finally {
    // Both successful and failed/aborted streaming generations end before export.
    input.timing?.mark('trace_flush_start')
    await flushLangfuse()
    input.timing?.mark('trace_flush_complete')
  }
}
