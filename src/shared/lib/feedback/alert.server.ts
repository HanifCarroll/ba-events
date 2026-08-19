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

export async function sendFeedbackAlert(
	message: string,
	config = getConfig(),
	fetcher: typeof fetch = fetch,
): Promise<FeedbackAlertResult> {
	if (!config.apiKey || !config.from || !config.to) {
		console.warn('[feedback] email alert is not configured')
		return { delivered: false, reason: 'not_configured' }
	}

	try {
		const response = await fetcher(RESEND_EMAILS_URL, {
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
		})

		if (!response.ok) {
			console.error('[feedback] email alert failed:', response.status)
			return { delivered: false, reason: 'provider_error' }
		}

		return { delivered: true }
	} catch (error) {
		console.error('[feedback] email alert failed:', error instanceof Error ? error.name : 'unknown')
		return { delivered: false, reason: 'provider_error' }
	}
}
