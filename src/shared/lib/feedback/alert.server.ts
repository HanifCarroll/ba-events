import { Effect } from 'effect'

const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

export interface FeedbackAlertConfig {
	apiKey?: string
	from?: string
	to?: string
}

export interface FeedbackAlertResult {
	delivered: boolean
	reason?: 'not_configured' | 'provider_error'
}

function getConfig(): FeedbackAlertConfig {
	return {
		apiKey: process.env.RESEND_API_KEY,
		from: process.env.FEEDBACK_ALERT_FROM,
		to: process.env.FEEDBACK_ALERT_TO,
	}
}

class FeedbackAlertError extends Error {
	readonly _tag = 'FeedbackAlertError'
}

export async function sendFeedbackAlert(
	message: string,
	config = getConfig(),
	fetcher: typeof fetch = fetch,
): Promise<FeedbackAlertResult> {
	if (!config.apiKey || !config.from || !config.to) {
		console.warn('[feedback] email alert is not configured')
		return { delivered: false, reason: 'not_configured' }
	}

	const program = Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () => fetcher(RESEND_EMAILS_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					from: config.from,
					to: [config.to],
					subject: 'New BA Eventos feedback',
					text: `New feedback received:\n\n${message}`,
				}),
			}),
			catch: (error) => new FeedbackAlertError(error instanceof Error ? error.message : String(error)),
		})

		if (!response.ok) {
			return yield* Effect.fail(new FeedbackAlertError(`provider returned ${response.status}`))
		}
		return { delivered: true as const }
	})

	try {
		return await Effect.runPromise(program)
	} catch (error) {
		console.error('[feedback] email alert failed:', error instanceof Error ? error.name : 'unknown')
		return { delivered: false, reason: 'provider_error' }
	}
}
