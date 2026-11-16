import { describe, expect, it, vi } from 'vitest'
import { feedbackAlertConfig, sendFeedbackAlert } from './alert.server.ts'

describe('sendFeedbackAlert', () => {
	it('does not attempt delivery without the binding or a recipient', async () => {
		const mailer = { send: vi.fn() }

		await expect(sendFeedbackAlert('Great events!', {})).resolves.toEqual({ delivered: false, reason: 'not_configured' })
		await expect(sendFeedbackAlert('Great events!', { mailer })).resolves.toEqual({ delivered: false, reason: 'not_configured' })
		await expect(sendFeedbackAlert('Great events!', { to: 'hanif@example.com' })).resolves.toEqual({ delivered: false, reason: 'not_configured' })
		expect(mailer.send).not.toHaveBeenCalled()
	})

	it('sends the feedback to the configured recipient through the email binding', async () => {
		const mailer = { send: vi.fn(async () => ({ messageId: 'm1' })) }

		await expect(sendFeedbackAlert('Great events!', { mailer, to: 'hanif@example.com' })).resolves.toEqual({ delivered: true })

		expect(mailer.send).toHaveBeenCalledWith({
			from: { name: 'BA Eventos', email: 'alerts@baeventos.com' },
			to: 'hanif@example.com',
			subject: 'New BA Eventos feedback',
			text: 'New feedback received:\n\nGreat events!',
		})
	})

	it('keeps feedback submission successful when Cloudflare rejects the email', async () => {
		const mailer = { send: vi.fn(async () => { throw Object.assign(new Error('domain not onboarded'), { code: 'E_SENDER_DOMAIN_NOT_AVAILABLE' }) }) }
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})

		await expect(sendFeedbackAlert('Great events!', { mailer, to: 'hanif@example.com' })).resolves.toEqual({ delivered: false, reason: 'provider_error' })
		expect(error).toHaveBeenCalledWith('[feedback] email alert failed:', 'E_SENDER_DOMAIN_NOT_AVAILABLE')
		error.mockRestore()
	})

	it('reads the binding from the platform env and the recipient from process.env', () => {
		const mailer = { send: vi.fn() }
		vi.stubEnv('FEEDBACK_ALERT_TO', 'hanif@example.com')
		expect(feedbackAlertConfig({ EMAIL: mailer })).toEqual({ mailer, to: 'hanif@example.com' })
		expect(feedbackAlertConfig(undefined)).toEqual({ mailer: undefined, to: 'hanif@example.com' })
		vi.unstubAllEnvs()
	})
})
