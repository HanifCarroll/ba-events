import type { ConversationCase } from './conversations.ts'

/** Hold out mixed requests from the routine directions happy path. */
export const DIRECTIONS_COMPLETION_CASES: ConversationCase[] = [
  { id: 'direct-completion-en', locale: 'en', turns: [
    { message: 'Show me three free events in Palermo tonight.', expect: { kind: 'recommendations', tools: ['search_events'], minEvents: 3, maxEvents: 3, neighborhood: 'Palermo', isFree: true, tonight: true } },
    { message: 'For the second event, give me directions AND explain what its source description says happens there. I need both.', expect: { kind: 'directions', alternativeKinds: ['event_details'], tools: ['get_directions', 'get_event_details'], forbiddenTools: ['search_events'], targetIndex: 1 } },
    { message: 'Now just give me directions to the third event.', expect: { kind: 'directions', tools: ['get_directions'], forbiddenTools: ['search_events'], targetIndex: 2 } },
  ] },
  { id: 'direct-completion-es', locale: 'es', turns: [
    { message: 'Mostrame tres eventos gratis en Palermo para esta noche.', expect: { kind: 'recommendations', tools: ['search_events'], minEvents: 3, maxEvents: 3, neighborhood: 'Palermo', isFree: true, tonight: true } },
    { message: 'Del segundo evento, dame las indicaciones Y explicame qué se hace según su descripción original. Necesito ambas cosas.', expect: { kind: 'directions', alternativeKinds: ['event_details'], tools: ['get_directions', 'get_event_details'], forbiddenTools: ['search_events'], targetIndex: 1 } },
    { message: 'Ahora solo pasame las indicaciones al tercer evento.', expect: { kind: 'directions', tools: ['get_directions'], forbiddenTools: ['search_events'], targetIndex: 2 } },
  ] },
]
