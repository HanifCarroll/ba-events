import type { TelegramCommand } from './update.ts'
import type { TelegramReplyMarkup } from './client.ts'

export const PRIVACY_URL = 'https://baeventos.com/privacy'

export const COPY = {
  en: {
    start: 'Hi! I use AI to help find Buenos Aires events. Chats may be stored for up to 30 days. Use /delete anytime. By continuing, you agree to the privacy policy.',
    promptQueries: {
      chill: 'Anything chill tonight?',
      weekend: "What's on this weekend?",
      free: 'Free events nearby',
      live: 'Live music tonight',
    },
    help: 'Ask me for events, dates, neighborhoods, venues, or directions. Commands: /new, /privacy, /delete. Saving and account linking are not available in Telegram.',
    fresh: 'Started a new conversation.',
    privacy: 'Telegram privacy details. Chats may be stored for up to 30 days. Use /delete at any time to delete your conversation data.',
    privacyButton: 'Privacy',
    legacyAccepted: 'Thanks. You can send me an event question anytime.',
    declined: 'Declined. Your Telegram conversation data was deleted.',
    deleted: 'Your Telegram conversation data was deleted.',
    rateLimited: 'Too many requests right now. Please try again later. /help, /privacy, and /delete remain available.',
    unsupported: 'I did not recognize that command. Try /help.',
    draft: 'Finding events…',
    found: 'Found events…',
  },
  es: {
    start: '¡Hola! Uso IA para ayudarte a encontrar eventos en Buenos Aires. Los chats pueden guardarse hasta 30 días. Usá /delete cuando quieras. Al continuar, aceptás la política de privacidad.',
    promptQueries: {
      chill: '¿Algo tranqui para hoy?',
      weekend: '¿Qué hay este finde?',
      free: 'Eventos gratis cerca',
      live: 'Música en vivo hoy',
    },
    help: 'Preguntame por eventos, fechas, barrios, lugares o cómo llegar. Comandos: /new, /privacy, /delete. Telegram no permite guardar eventos ni vincular cuentas.',
    fresh: 'Empezamos una conversación nueva.',
    privacy: 'Detalles de privacidad de Telegram. Los chats pueden guardarse hasta 30 días. Usá /delete en cualquier momento para borrar los datos de tu conversación.',
    privacyButton: 'Privacidad',
    legacyAccepted: 'Gracias. Podés mandarme una pregunta sobre eventos cuando quieras.',
    declined: 'Rechazado. Eliminamos los datos de tu conversación de Telegram.',
    deleted: 'Eliminamos los datos de tu conversación de Telegram.',
    rateLimited: 'Hay demasiadas solicitudes. Probá más tarde. /help, /privacy y /delete siguen disponibles.',
    unsupported: 'No reconocí ese comando. Probá /help.',
    draft: 'Buscando eventos…',
    found: 'Encontré eventos…',
  },
} as const

export function localeFrom(
  languageCode?: string,
  conversationLocale?: unknown,
): 'en' | 'es' {
  if (conversationLocale === 'en' || conversationLocale === 'es') return conversationLocale
  return languageCode?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function privacyKeyboard(locale: 'en' | 'es') {
  return { inline_keyboard: [[{ text: COPY[locale].privacyButton, url: PRIVACY_URL }]] }
}

export function commandReply(command: Exclude<TelegramCommand, 'delete'>, locale: 'en' | 'es'): {
  text: string
  replyMarkup?: TelegramReplyMarkup
} {
  if (command === 'start') {
    return { text: `${COPY[locale].start}\n\n${PRIVACY_URL}`, replyMarkup: { remove_keyboard: true } }
  }
  if (command === 'help') return { text: COPY[locale].help }
  if (command === 'privacy') return { text: COPY[locale].privacy, replyMarkup: privacyKeyboard(locale) }
  return { text: COPY[locale].fresh }
}
