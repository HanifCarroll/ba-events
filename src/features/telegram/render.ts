import type { CanonicalChatResponse, CanonicalChatEventPayload } from '#shared/lib/types.ts'
import type { TelegramInlineKeyboardMarkup, TelegramReplyMarkup } from './client.ts'

const SITE_ORIGIN = 'https://baeventos.com'
const TIME_ZONE = 'America/Argentina/Buenos_Aires'
const MAX_MESSAGE = 4096

export interface TelegramRenderedMessage<ReplyMarkup extends TelegramReplyMarkup = TelegramReplyMarkup> {
  text: string
  replyMarkup?: ReplyMarkup
}

const COPY = {
  en: {
    saveUnavailable: "Saving events isn't available in Telegram yet.",
    unsaveUnavailable: "Saved-event controls aren't available in Telegram yet.",
    loginUnavailable: "Saved events aren't linked to Telegram in this pilot.",
    free: 'Free',
    timeTba: 'Time TBA',
    locationTba: 'Location TBA',
    details: 'Details',
    tickets: 'Tickets / event page',
    directions: 'Directions',
    venue: 'Venue',
    instagram: 'Instagram',
  },
  es: {
    saveUnavailable: 'Todavía no se pueden guardar eventos desde Telegram.',
    unsaveUnavailable: 'Los controles de guardados todavía no están disponibles en Telegram.',
    loginUnavailable: 'En este piloto, los guardados no están vinculados con Telegram.',
    free: 'Gratis',
    timeTba: 'Horario a confirmar',
    locationTba: 'Ubicación a confirmar',
    details: 'Detalles',
    tickets: 'Entradas / evento',
    directions: 'Cómo llegar',
    venue: 'Lugar',
    instagram: 'Instagram',
  },
} as const

function plain(value: string, max = 500): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[\\*_`~#[\]>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function instagramUrl(value: string | null | undefined): string | null {
  const input = value?.trim()
  if (!input) return null
  const handle = input.startsWith('@') ? input.slice(1) : input
  if (/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
    return `https://www.instagram.com/${encodeURIComponent(handle)}`
  }
  const url = httpsUrl(input)
  return url && ['instagram.com', 'www.instagram.com'].includes(new URL(url).hostname) ? url : null
}

function formatDate(event: CanonicalChatEventPayload, locale: 'en' | 'es'): string {
  const date = new Date(event.starts_at)
  if (Number.isNaN(date.getTime())) return ''
  const language = locale === 'es' ? 'es-AR' : 'en-US'
  const dateText = new Intl.DateTimeFormat(language, {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
  }).format(date)
  if (event.is_all_day) return dateText
  if (event.time_tba) return `${dateText} · ${COPY[locale].timeTba}`
  const time = new Intl.DateTimeFormat(language, {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: locale === 'es' ? 'h23' : 'h12',
  }).format(date)
  return `${dateText} · ${time}`
}

function formatPrice(event: CanonicalChatEventPayload, locale: 'en' | 'es'): string | null {
  if (event.is_free || event.price === 0) return COPY[locale].free
  if (event.price == null || !Number.isFinite(event.price)) return null
  return new Intl.NumberFormat(locale === 'es' ? 'es-AR' : 'en-US', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(event.price)
}

function eventText(event: CanonicalChatEventPayload, index: number, locale: 'en' | 'es'): string {
  const place = event.location_hidden
    ? COPY[locale].locationTba
    : plain(event.venue_name || event.venue_neighborhood || COPY[locale].locationTba, 120)
  return [
    `${index + 1}. ${plain(event.name, 180)}`,
    [formatDate(event, locale), place, formatPrice(event, locale)].filter(Boolean).join(' · '),
  ].join('\n')
}

function lead(response: CanonicalChatResponse, locale: 'en' | 'es'): string {
  if (response.messageKey === 'use_save_control') return COPY[locale].saveUnavailable
  if (response.messageKey === 'use_unsave_control') return COPY[locale].unsaveUnavailable
  if (response.messageKey === 'login_required') return COPY[locale].loginUnavailable
  return plain(response.text, 800)
}

function truncate(value: string): string {
  if (value.length <= MAX_MESSAGE) return value
  let output = value.slice(0, MAX_MESSAGE - 1).trimEnd()
  if (/^[\uD800-\uDBFF]$/.test(output.at(-1) ?? '')) output = output.slice(0, -1)
  return `${output}…`
}

export function renderTelegramMessage(
  response: CanonicalChatResponse,
  locale: 'en' | 'es',
): TelegramRenderedMessage<TelegramInlineKeyboardMarkup> {
  const copy = COPY[locale]
  const events = response.events.slice(0, 5)
  const sections = [lead(response, locale), ...events.map((event, index) => eventText(event, index, locale))]
    .filter(Boolean)
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = []

  for (const event of events) {
    const row: TelegramInlineKeyboardMarkup['inline_keyboard'][number] = [
      { text: copy.details, url: `${SITE_ORIGIN}/events/${encodeURIComponent(event.id)}` },
    ]
    const external = httpsUrl(event.ticket_url) ?? httpsUrl(event.link)
    if (external) row.push({ text: copy.tickets, url: external })
    rows.push(row)
  }

  const directions = httpsUrl(response.directions?.mapsUrl)
  if (directions) rows.push([{ text: copy.directions, url: directions }])
  const venue = httpsUrl(response.venue?.website)
  if (venue) rows.push([{ text: copy.venue, url: venue }])
  const instagram = instagramUrl(response.venue?.instagram)
  if (instagram) rows.push([{ text: copy.instagram, url: instagram }])

  return {
    text: truncate(sections.join('\n\n')),
    ...(rows.length ? { replyMarkup: { inline_keyboard: rows } } : {}),
  }
}
