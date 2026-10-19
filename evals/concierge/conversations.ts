import type { Neighborhood, ResponseKind } from '#shared/lib/types.ts'

export interface TurnExpectation {
  kind: ResponseKind
  alternativeKinds?: ResponseKind[]
  minEvents?: number
  maxEvents?: number
  tools?: string[]
  forbiddenTools?: string[]
  /** Resolve against the newest actual result-bearing response, never a golden list. */
  targetIndex?: number
  neighborhood?: Neighborhood
  isFree?: boolean
  maxPrice?: number
  tonight?: boolean
}

export interface ConversationTurn { message: string; expect: TurnExpectation }
export interface ConversationCase { id: string; locale: 'en' | 'es'; turns: ConversationTurn[] }

const search = (neighborhood: Neighborhood, isFree = true): TurnExpectation => ({
  kind: 'recommendations', tools: ['search_events'], minEvents: 3, maxEvents: 3,
  neighborhood, ...(isFree ? { isFree: true } : {}), tonight: true,
})
const details = (targetIndex: number): TurnExpectation => ({ kind: 'event_details',
  tools: ['get_event_details'], forbiddenTools: ['search_events'], minEvents: 0, maxEvents: 0, targetIndex })
const directions = (targetIndex: number): TurnExpectation => ({ kind: 'directions',
  tools: ['get_directions'], forbiddenTools: ['search_events'], targetIndex })

export const CONVERSATIONS: ConversationCase[] = [
  { id: 'ordinal-details-directions-en', locale: 'en', turns: [
    { message: 'Show me three free events in Palermo tonight.', expect: search('Palermo') },
    { message: 'Tell me more about the second one.', expect: details(1) },
    { message: 'How do I get to that event?', expect: directions(1) },
  ] },
  { id: 'ordinal-details-directions-es', locale: 'es', turns: [
    { message: 'Mostrame tres eventos gratis en Palermo para esta noche.', expect: search('Palermo') },
    { message: 'Contame más sobre el tercero.', expect: details(2) },
    { message: '¿Cómo llego a ese evento?', expect: directions(2) },
  ] },
  { id: 'refinement-constraints-en', locale: 'en', turns: [
    { message: 'Show me three events in Palermo tonight.', expect: search('Palermo', false) },
    { message: 'Keep the same neighborhood and tonight, but only free options. Show three.', expect: search('Palermo') },
    { message: 'Which of those is the second option? Tell me its details.', expect: details(1) },
  ] },
  { id: 'refinement-budget-en', locale: 'en', turns: [
    { message: 'Show me three events in Palermo tonight with tickets at most 15000 pesos.', expect: { ...search('Palermo', false), maxPrice: 15000 } },
    { message: 'Change the maximum price to 5000 pesos, keeping Palermo and tonight. Show three.', expect: { ...search('Palermo', false), maxPrice: 5000 } },
    { message: 'Tell me more about the first one.', expect: details(0) },
  ] },
  { id: 'newest-list-es', locale: 'es', turns: [
    { message: 'Mostrame tres eventos gratis en Palermo para esta noche.', expect: search('Palermo') },
    { message: 'Mejor en San Telmo, manteniendo el horario y que sean gratis. Mostrame tres.', expect: search('San Telmo') },
    { message: 'Contame más sobre el segundo de esta última lista.', expect: details(1) },
  ] },
  { id: 'clarification-recovery-en', locale: 'en', turns: [
    { message: 'Give me directions to the second event.', expect: { kind: 'clarification', tools: ['ask_clarification'], forbiddenTools: ['get_event_details', 'get_directions', 'search_events'], maxEvents: 0 } },
    { message: 'First show me three free events in San Telmo tonight.', expect: search('San Telmo') },
    { message: 'Now give me directions to the second one.', expect: directions(1) },
  ] },
  { id: 'missing-description-en', locale: 'en', turns: [
    { message: "What's on at Casa SinTexto tonight?", expect: { kind: 'recommendations', tools: ['search_events'], minEvents: 1, maxEvents: 1, tonight: true } },
    { message: 'Tell me the details of the first option.', expect: details(0) },
    { message: 'Which of these inspected options would you recommend for live jazz? Only recommend a match if its source description confirms live jazz.', expect: { kind: 'recommendations', tools: ['recommendations_mismatch'], forbiddenTools: ['search_events'], maxEvents: 0 } },
  ] },
  { id: 'empty-search-recovery-es', locale: 'es', turns: [
    { message: 'Mostrame tres eventos gratis en Recoleta para esta noche.', expect: { ...search('Recoleta'), kind: 'no_results', minEvents: 0, maxEvents: 0 } },
    { message: 'Entonces buscá en Palermo, manteniendo que sean gratis y para esta noche. Mostrame tres.', expect: search('Palermo') },
    { message: '¿Cómo llego al tercero?', expect: directions(2) },
  ] },
  { id: 'simple-assessment-en', locale: 'en', turns: [
    { message: 'Show me three free events in Palermo tonight.', expect: search('Palermo') },
    { message: 'Does the second one look fun? What actually happens there?', expect: { ...details(1), alternativeKinds: ['recommendations'] } },
    { message: 'How do I get to that event?', expect: directions(1) },
  ] },
  { id: 'simple-assessment-es', locale: 'es', turns: [
    { message: 'Mostrame tres eventos gratis en Palermo para esta noche.', expect: search('Palermo') },
    { message: '¿El segundo parece divertido? ¿Qué se hace ahí?', expect: { ...details(1), alternativeKinds: ['recommendations'] } },
    { message: '¿Cómo llego a ese evento?', expect: directions(1) },
  ] },
  { id: 'missing-description-es', locale: 'es', turns: [
    { message: '¿Qué hay en Casa SinTexto esta noche?', expect: { kind: 'recommendations', tools: ['search_events'], minEvents: 1, maxEvents: 1, tonight: true } },
    { message: 'Contame los detalles de la primera opción.', expect: details(0) },
    { message: '¿Recomendarías esa opción para escuchar jazz en vivo? Solo recomendala si la descripción de la fuente confirma jazz en vivo.', expect: { kind: 'recommendations', tools: ['recommendations_mismatch'], forbiddenTools: ['search_events'], maxEvents: 0 } },
  ] },
]
