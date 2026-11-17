import { Data, Effect } from 'effect'
import type { Locale } from '#shared/lib/types.ts'

/**
 * The magic-link email, sent through the Worker's Cloudflare Email Sending (`send_email`) binding `EMAIL`. The HTML
 * follows docs/supabase-magic-link-email-template.html, in Spanish or English by the sign-in page's locale.
 */
export const MAGIC_LINK_FROM = { name: 'BA Eventos', email: 'accounts@baeventos.com' }

/** Structural subset of the `send_email` binding, as in feedback/alert.server.ts. */
export interface MagicLinkMailer {
	send(message: { from: typeof MAGIC_LINK_FROM; to: string; subject: string; html: string; text: string }): Promise<unknown>
}

export class MagicLinkEmailError extends Data.TaggedError('MagicLinkEmailError')<{ readonly message: string; readonly cause?: unknown }> {}

/** Minutes a link stays valid (Better Auth's magicLink `expiresIn`). */
export const MAGIC_LINK_MINUTES = 15

const copy = {
	es: {
		subject: 'Tu enlace para entrar a BA Eventos',
		title: 'Inicia sesión en tu cuenta',
		body: `Toca el botón para entrar a BA Eventos de forma segura. Este enlace vence en ${MAGIC_LINK_MINUTES} minutos y sirve una sola vez.`,
		button: 'Entrar a BA Eventos',
		ignore: 'Si no pediste este correo, puedes ignorarlo.',
		footer: 'Descubre los mejores eventos de Buenos Aires',
	},
	en: {
		subject: 'Your BA Eventos sign-in link',
		title: 'Sign in to your account',
		body: `Click the button below to securely sign in to BA Eventos. This link expires in ${MAGIC_LINK_MINUTES} minutes and works once.`,
		button: 'Sign in to BA Eventos',
		ignore: "If you didn't request this email, you can safely ignore it.",
		footer: 'Discover the best events in Buenos Aires',
	},
} as const

const escapeHtml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function magicLinkEmail(url: string, locale: Locale, year = new Date().getUTCFullYear()) {
	const t = copy[locale]
	const href = escapeHtml(url)
	const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f3f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f5f3f0" style="background-color: #f5f3f0;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #e8e5e1;">
              <table role="presentation" cellspacing="0" cellpadding="0" align="center">
                <tr>
                  <td style="width: 4px; height: 28px; background: linear-gradient(to bottom, #d4af37, #b8860b); border-radius: 4px;"></td>
                  <td style="padding-left: 10px; font-size: 24px; font-weight: 600; color: #1a1612; letter-spacing: -0.5px;">BA Eventos</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 600; color: #1a1612; text-align: center;">${t.title}</h1>
              <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #57534e; text-align: center;">${t.body}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="${href}" style="display: inline-block; padding: 14px 32px; background-color: #1a1612; color: #d4af37; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">${t.button}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 28px 0 0; font-size: 13px; line-height: 1.6; color: #a8a29e; text-align: center;">${t.ignore}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px; background-color: #faf8f5; border-top: 1px solid #e8e5e1;">
              <p style="margin: 0; font-size: 12px; color: #78716c; text-align: center; line-height: 1.5;">${t.footer}<br>&copy; ${year} BA Eventos</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
	const text = `${t.title}\n\n${t.body}\n\n${url}\n\n${t.ignore}\n`
	return { subject: t.subject, html, text }
}

export function sendMagicLinkEffect(mailer: MagicLinkMailer | undefined, to: string, url: string, locale: Locale) {
	if (!mailer) return Effect.fail(new MagicLinkEmailError({ message: 'Email sending is not configured' }))
	return Effect.tryPromise({
		try: () => mailer.send({ from: MAGIC_LINK_FROM, to, ...magicLinkEmail(url, locale) }),
		// Never include the link (a sign-in credential) in the error.
		catch: (cause) => new MagicLinkEmailError({ message: `Failed to send the sign-in email (${(cause as { code?: string })?.code ?? 'unknown'})` }),
	}).pipe(Effect.asVoid)
}
