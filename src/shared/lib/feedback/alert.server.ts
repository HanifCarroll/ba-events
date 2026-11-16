import { Effect } from 'effect'

/** Sender for feedback alerts; it must be on a domain onboarded to Cloudflare Email Sending. */
export const FEEDBACK_ALERT_FROM = { name: 'BA Eventos', email: 'alerts@baeventos.com' }

/** Structural subset of the Worker's Cloudflare Email Sending (`send_email`) binding. */
export interface FeedbackMailer {
	send(message: { from: typeof FEEDBACK_ALERT_FROM; to: string; subject: string; text: string }): Promise<unknown>
}

export interface FeedbackAlertConfig {
	mailer?: FeedbackMailer
	to?: string
}

export interface FeedbackAlertResult {
	delivered: boolean
	reason?: 'not_configured' | 'provider_error'
}

export function feedbackAlertConfig(platformEnv?: { EMAIL?: FeedbackMailer }): FeedbackAlertConfig {
	return { mailer: platformEnv?.EMAIL, to: process.env.FEEDBACK_ALERT_TO }
}

class FeedbackAlertError extends Error {
	readonly _tag = 'FeedbackAlertError'
}

export async function sendFeedbackAlert(message: string, config: FeedbackAlertConfig): Promise<FeedbackAlertResult> {
	const { mailer, to } = config
	if (!mailer || !to) {
		console.warn('[feedback] email alert is not configured')
		return { delivered: false, reason: 'not_configured' }
	}

	const program = Effect.tryPromise({
		try: () => mailer.send({
			from: FEEDBACK_ALERT_FROM,
			to,
			subject: 'New BA Eventos feedback',
			text: `New feedback received:\n\n${message}`,
		}),
		catch: (error) => new FeedbackAlertError((error as { code?: string })?.code || 'unknown error'),
	}).pipe(Effect.as({ delivered: true as const }))

	try {
		return await Effect.runPromise(program)
	} catch (error) {
		console.error('[feedback] email alert failed:', error instanceof Error ? error.message : 'unknown')
		return { delivered: false, reason: 'provider_error' }
	}
}
