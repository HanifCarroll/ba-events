/**
 * Deterministic server-side text materialization for the v5 canonical response.
 *
 * Text is derived from a closed `messageKey` plus validated artifact facts
 * (event/venue/directions names) and the locale. No arbitrary model prose ever
 * reaches `canonical.text`. Operation receipts render separately — text never
 * duplicates them. Clarification questions are fixed templates too, so they
 * carry no artifact facts.
 */

import type {
  ClarificationKey,
  ClarificationQuestion,
  MessageKey,
  ResponseKind,
} from '#shared/lib/types.ts'

/** Which response kind each messageKey may materialize under. */
export const MESSAGE_KEY_KIND: Record<MessageKey, ResponseKind> = {
  recommendations: 'recommendations',
  recommendations_pick: 'recommendations',
  event_details: 'event_details',
  saved_events: 'saved_events',
  directions: 'directions',
  venue_details: 'venue_details',
  clarification: 'clarification',
  no_results: 'no_results',
  out_of_scope: 'out_of_scope',
  share_guidance: 'out_of_scope',
  error: 'error',
  mutation_applied: 'mutation_result',
  mutation_already_applied: 'mutation_result',
  mutation_unauthenticated: 'mutation_result',
  mutation_not_found: 'mutation_result',
  mutation_failed: 'mutation_result',
  mutation_mixed: 'mutation_result',
  partial_results: 'recommendations',
  pinned_event_unavailable: 'error',
  use_save_control: 'event_details',
  use_unsave_control: 'event_details',
  login_required: 'saved_events',
}

export interface MaterializeTextInput {
  messageKey: MessageKey
  locale: 'en' | 'es'
  /** First selected event name (event_details lead). */
  eventName?: string
  /** Directions venue name (directions lead). */
  directionsVenueName?: string
  /** Venue name (venue_details lead). */
  venueName?: string
}

const TEXTS: Record<MessageKey, { en: string; es: string }> = {
  recommendations: {
    en: 'Here are the best matches I found.',
    es: 'Estas son las mejores opciones que encontré.',
  },
  recommendations_pick: {
    en: 'This one looks like a great fit.',
    es: 'Este me parece una gran opción.',
  },
  event_details: {
    en: 'Here are the details.',
    es: 'Acá están los detalles.',
  },
  saved_events: {
    en: "Here's your saved list.",
    es: 'Estos son tus guardados.',
  },
  directions: {
    en: "Here's how to get there.",
    es: 'Acá tenés cómo llegar.',
  },
  venue_details: {
    en: "Here's what I found about this venue.",
    es: 'Esto es lo que encontré de este lugar.',
  },
  clarification: {
    en: 'Let me narrow this down.',
    es: 'Déjame acotar la búsqueda.',
  },
  no_results: {
    en: "I couldn't find anything matching. Want me to widen the search?",
    es: 'No encontré nada que coincida. ¿Querés que amplíe la búsqueda?',
  },
  out_of_scope: {
    en: 'I can help you find events in Buenos Aires. What kind of event are you after?',
    es: 'Te ayudo a encontrar eventos en Buenos Aires. ¿Qué tipo de evento buscás?',
  },
  share_guidance: {
    en: 'Use the share button on the event card to share it with a friend.',
    es: 'Usá el botón de compartir en la tarjeta del evento para compartirlo con un amigo.',
  },
  error: {
    en: 'Something went wrong. Please try again.',
    es: 'Algo salió mal. Probá de nuevo.',
  },
  mutation_applied: {
    en: 'Your saved events are updated.',
    es: 'Actualicé tus guardados.',
  },
  mutation_already_applied: {
    en: 'Your saved events are already up to date.',
    es: 'Tus guardados ya están al día.',
  },
  mutation_unauthenticated: {
    en: "Here's what happened.",
    es: 'Esto fue lo que pasó.',
  },
  mutation_not_found: {
    en: "Here's what happened.",
    es: 'Esto fue lo que pasó.',
  },
  mutation_failed: {
    en: "Here's what happened.",
    es: 'Esto fue lo que pasó.',
  },
  mutation_mixed: {
    en: "Here's what happened.",
    es: 'Esto fue lo que pasó.',
  },
  partial_results: {
    en: "I found these, but part of the search didn't complete.",
    es: 'Encontré estas opciones, pero una parte de la búsqueda no se pudo completar.',
  },
  pinned_event_unavailable: {
    en: "I couldn't load that event.",
    es: 'No pude cargar ese evento.',
  },
  use_save_control: {
    en: 'Use the heart button on this card to add it to your saved events.',
    es: 'Usá el botón del corazón de esta tarjeta para agregarlo a tus guardados.',
  },
  use_unsave_control: {
    en: 'Use the filled heart button on this card to remove it from your saved events.',
    es: 'Usá el botón del corazón marcado de esta tarjeta para quitarlo de tus guardados.',
  },
  login_required: {
    en: 'Log in to see your saved events.',
    es: 'Iniciá sesión para ver tus guardados.',
  },
}

function cleanName(value: string | undefined, max = 80): string | undefined {
  if (!value) return undefined
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return undefined
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

export function materializeText(input: MaterializeTextInput): string {
  const base = TEXTS[input.messageKey]
  const localized = input.locale === 'es' ? base.es : base.en

  // Interpolate a single validated, sanitized name where the template calls for it.
  const eventName = cleanName(input.eventName)
  const directionsVenueName = cleanName(input.directionsVenueName)
  const venueName = cleanName(input.venueName)

  if (input.messageKey === 'event_details' && eventName) {
    return input.locale === 'es'
      ? `Acá están los detalles de ${eventName}.`
      : `Here are the details for ${eventName}.`
  }
  if (input.messageKey === 'directions' && directionsVenueName) {
    return input.locale === 'es'
      ? `Acá tenés cómo llegar a ${directionsVenueName}.`
      : `Here's how to get to ${directionsVenueName}.`
  }
  if (input.messageKey === 'venue_details' && venueName) {
    return input.locale === 'es'
      ? `Esto es lo que encontré de ${venueName}.`
      : `Here's what I found about ${venueName}.`
  }
  return localized
}

const CLARIFICATION_LABELS: Record<ClarificationKey, { en: string; es: string }> = {
  which_event: {
    en: 'Which event are you asking about?',
    es: '¿Sobre qué evento preguntás?',
  },
  which_day: {
    en: 'Which day are you interested in?',
    es: '¿Qué día te interesa?',
  },
  which_time: {
    en: 'What time works for you?',
    es: '¿A qué hora te queda bien?',
  },
  which_neighborhood: {
    en: 'Which neighborhood do you prefer?',
    es: '¿Qué barrio preferís?',
  },
  which_category: {
    en: 'What kind of event are you looking for?',
    es: '¿Qué tipo de evento buscás?',
  },
  which_venue: {
    en: 'Which venue do you mean?',
    es: '¿A qué lugar te referís?',
  },
  budget: {
    en: "What's your budget?",
    es: '¿Cuál es tu presupuesto?',
  },
}

export function materializeClarificationQuestions(
  keys: ClarificationKey[],
  locale: 'en' | 'es'
): ClarificationQuestion[] {
  return keys.slice(0, 2).map((key) => ({
    key,
    label: locale === 'es' ? CLARIFICATION_LABELS[key].es : CLARIFICATION_LABELS[key].en,
  }))
}

/**
 * The single streamed text block for a clarification response: the fixed-template
 * question labels joined in order. Labels are already localized and carry their
 * own punctuation, so the text always contains a `?` and never free prose.
 */
export function materializeClarificationText(questions: ClarificationQuestion[]): string {
  return questions.map((q) => q.label).join(' ')
}
