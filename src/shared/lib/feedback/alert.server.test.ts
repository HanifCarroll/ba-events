import { describe, expect, it, vi } from 'vitest'
import { sendFeedbackAlert } from './alert.server.ts'

describe('sendFeedbackAlert', () => {
	it('does not attempt delivery without all email settings', async () => {
		const fetcher = vi.fn()

		await expect(sendFeedbackAlert('Great events!', {}, fetcher)).resolves.toEqual({
			delivered: false,
			reason: 'not_configured',
		})
		expect(fetcher).not.toHaveBeenCalled()
	})

	it('sends the feedback to the configured recipient', async () => {
		let deliveredPayload: unknown
		const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
			deliveredPayload = JSON.parse(init?.body as string)
			return new Response('', { status: 200 })
		})

		await expect(
			sendFeedbackAlert(
				'Great events!',
				{ apiKey: 're_test', from: 'BA Eventos <feedback@baeventos.com>', to: 'hanif@hanifcarroll.com' },
				fetcher,
			),
		).resolves.toEqual({ delivered: true })

		expect(fetcher).toHaveBeenCalledWith(
			'https://api.resend.com/emails',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ Authorization: 'Bearer re_test' }),
			}),
		)
		expect(deliveredPayload).toEqual({
			from: 'BA Eventos <feedback@baeventos.com>',
			to: ['hanif@hanifcarroll.com'],
			subject: 'New BA Eventos feedback',
			text: 'New feedback received:\n\nGreat events!',
		})
	})

	it('keeps feedback submission successful when the email provider rejects it', async () => {
		const fetcher = vi.fn(async () => new Response('', { status: 422 }))

		await expect(
			sendFeedbackAlert('Great events!', { apiKey: 're_test', from: 'from@example.com', to: 'to@example.com' }, fetcher),
		).resolves.toEqual({ delivered: false, reason: 'provider_error' })
	})
})
