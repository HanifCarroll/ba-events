import { json, type RequestHandler } from '@sveltejs/kit'
import { Schema } from 'effect'
import { checkApiRateLimit, RATE_LIMIT_RETRY_SECONDS } from '#features/auth/api/rate-limit.server.ts'
import { requireD1 } from '#shared/lib/db/d1-binding.server.ts'
import { feedbackAlertConfig, sendFeedbackAlert, type FeedbackMailer } from '#shared/lib/feedback/alert.server.ts'

const MAX_FEEDBACK_LENGTH = 2000

const feedbackRequestSchema = Schema.Struct({
	message: Schema.optional(Schema.String),
})

export const POST: RequestHandler = async (event) => {
	const ip =
		event.getClientAddress() ||
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		event.request.headers.get('x-real-ip') ||
		'unknown'
	let limit: Awaited<ReturnType<typeof checkApiRateLimit>>
	try { limit = await checkApiRateLimit(ip) }
	catch {
		return json({ error: 'Feedback is temporarily unavailable. Please try again.' }, {
			status: 503, headers: { 'Retry-After': String(RATE_LIMIT_RETRY_SECONDS) },
		})
	}
	if (!limit.success) {
		return json({ error: 'Please wait before sending more feedback.' }, { status: 429 })
	}

	let message: string

  try {
    const parsed = Schema.decodeUnknownResult(feedbackRequestSchema)(await event.request.json())
    message = parsed._tag === 'Success' ? parsed.success.message?.trim() ?? '' : ''
  } catch {
    return json({ error: 'Feedback must be valid JSON.' }, { status: 400 })
  }

  if (!message || message.length > MAX_FEEDBACK_LENGTH) {
    return json({ error: `Feedback must be between 1 and ${MAX_FEEDBACK_LENGTH} characters.` }, { status: 400 })
  }

  try {
    // The signed-in user comes from the session hook, not the request body.
    await requireD1().prepare('INSERT INTO product_feedback (id, user_id, message) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), event.locals.user?.id ?? null, message).run()
  } catch {
    console.error('[feedback] failed to store submission')
    return json({ error: 'Unable to send feedback right now.' }, { status: 500 })
  }

  // Saving feedback is the source of truth. An email outage must not make someone submit twice.
  await sendFeedbackAlert(message, feedbackAlertConfig((event.platform as { env?: { EMAIL?: FeedbackMailer } } | undefined)?.env))

  return json({ success: true })
}
