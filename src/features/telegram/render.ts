import type { CanonicalChatResponse, CanonicalChatEventPayload } from '#shared/lib/types.ts'
import type { TelegramInlineKeyboardMarkup } from './client.ts'
import { extractRecommendationFraming, warmRecommendationFallback, type RecommendationFraming } from '#shared/lib/recommendation-framing.ts'

const SITE_ORIGIN = 'https://baeventos.com'
const TIME_ZONE = 'America/Argentina/Buenos_Aires'
const MAX_MESSAGE = 4096

export interface TelegramRenderedMessage {
  text: string
  replyMarkup?: TelegramInlineKeyboardMarkup
}

const COPY = {
  en: {
    saveUnavailable: "Saving events isn't available in Telegram yet.",
    unsaveUnavailable: "Saved-event controls aren't available in Telegram yet.",
    loginUnavailable: "Saved events aren't linked to Telegram in this pilot.",
    shareGuidance: 'Open the event link, then use your device’s share option to send it to a friend.',
    free: 'Free',
    timeTba: 'Time TBA',
    locationTba: 'Location TBA',
    directions: 'Directions',
    venue: 'Venue',
    instagram: 'Instagram',
    eventsLead: (count: number) => `Here are ${count} events:`,
    pickLead: 'My top pick:',
  },
  es: {
    saveUnavailable: 'Todavía no se pueden guardar eventos desde Telegram.',
    unsaveUnavailable: 'Los controles de guardados todavía no están disponibles en Telegram.',
    loginUnavailable: 'En este piloto, los guardados no están vinculados con Telegram.',
    shareGuidance: 'Abrí el enlace del evento y usá la opción de compartir de tu dispositivo para enviárselo a un amigo.',
    free: 'Gratis',
    timeTba: 'Horario a confirmar',
    locationTba: 'Ubicación a confirmar',
    directions: 'Cómo llegar',
    venue: 'Lugar',
    instagram: 'Instagram',
    eventsLead: (count: number) => `Acá tenés ${count} eventos:`,
    pickLead: 'Mi recomendación principal:',
  },
} as const

function plain(value: string, max = 500): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[\\*_`~#[\]>]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
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
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
  if (event.is_all_day) return dateText
  if (event.time_tba) return `${dateText} · ${COPY[locale].timeTba}`
  const time = new Intl.DateTimeFormat(language, {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: locale === 'es' ? 'h23' : 'h12',
  }).format(date)
  return `${dateText} · ${time}`
}

function formatPrice(event: CanonicalChatEventPayload, locale: 'en' | 'es'): string | null {
  if (event.is_free || event.price === 0) return COPY[locale].free
  if (event.price == null || !Number.isFinite(event.price)) return null
  const amount = new Intl.NumberFormat(locale === 'es' ? 'es-AR' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(event.price)
  return `ARS ${amount}`
}

function eventText(event: CanonicalChatEventPayload, index: number, locale: 'en' | 'es'): string {
  const place = event.location_hidden
    ? COPY[locale].locationTba
    : plain(event.venue_neighborhood || event.venue_name || COPY[locale].locationTba, 80)
  return [
    `${index + 1}. ${plain(event.name, 180)}`,
    [formatDate(event, locale), place, formatPrice(event, locale)].filter(Boolean).join(' · '),
    (() => {
      const description = event.recommendation_reason || (locale === 'es'
        ? event.description_summary_es || event.description_display_es || event.description_es
        : event.description_summary_en || event.description_display_en || event.description_en)
      return description && !event.description_unavailable ? plain(description, 180).replace(/\s+/g, ' ') : null
    })(),
  ].filter(Boolean).join('\n')
}

function framing(response: CanonicalChatResponse, locale: 'en' | 'es', events: CanonicalChatEventPayload[]): RecommendationFraming {
  const stored = response.framing
  const checked = stored
    ? extractRecommendationFraming(`ACK: ${stored.acknowledgement}\nNEXT: ${stored.nextStep}`, events, [
        ...response.events.map((event) => event.venue_name ?? ''),
        ...(response.venue?.venueName ? [response.venue.venueName] : []),
      ])
    : null
  return checked ?? warmRecommendationFallback(locale, events.length)
}

function lead(response: CanonicalChatResponse, locale: 'en' | 'es', eventCount: number, recommendationFraming?: RecommendationFraming): string {
  if (response.messageKey === 'use_save_control') return COPY[locale].saveUnavailable
  if (response.messageKey === 'use_unsave_control') return COPY[locale].unsaveUnavailable
  if (response.messageKey === 'login_required') return COPY[locale].loginUnavailable
  if (response.messageKey === 'share_guidance') return COPY[locale].shareGuidance
  if (response.messageKey === 'recommendations_pick' && eventCount > 0) return COPY[locale].pickLead
  if (response.kind === 'recommendations' && eventCount > 0) return recommendationFraming?.acknowledgement ?? COPY[locale].eventsLead(eventCount)
  return plain(response.text, 800)
}

function truncate(value: string, max = MAX_MESSAGE): string {
  if (value.length <= max) return value
  let output = value.slice(0, max - 1).trimEnd()
  if (/^[\uD800-\uDBFF]$/.test(output.at(-1) ?? '')) output = output.slice(0, -1)
  return `${output}…`
}

export function renderTelegramMessage(
  response: CanonicalChatResponse,
  locale: 'en' | 'es',
): TelegramRenderedMessage {
  const copy = COPY[locale]
  const events = response.events.slice(0, 5)
  const recommendation = response.kind === 'recommendations' && response.messageKey !== 'recommendations_pick' && events.length > 0
    ? framing(response, locale, events)
    : null
  const sections = [
    lead(response, locale, events.length, recommendation ?? undefined),
    ...events.map((event, index) => eventText(event, index, locale)),
    ...(recommendation ? [recommendation.nextStep] : []),
  ].filter(Boolean)
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = []

  for (const [index, event] of events.entries()) {
    const prefix = `${index + 1} · `
    const name = truncate(plain(event.name), 64 - prefix.length)
    rows.push([{
      text: `${prefix}${name}`,
      url: `${SITE_ORIGIN}/events/${encodeURIComponent(event.id)}`,
    }])
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
