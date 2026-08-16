#!/usr/bin/env bun
/**
 * Pre-registered holdout queries for the pure-Voyage vs fused(2) decision.
 *
 * These cases are intentionally separate from live-queries.ts, which is now a
 * development/failure-analysis set. Capture and labels must be generated only
 * after this file is committed so no query is adapted to observed rankings.
 */

import type { SearchEventsInput } from '#features/chat/api/tools/search-events.ts'

export interface HoldoutQuery {
  id: string
  query: string
  toolInput?: Partial<SearchEventsInput>
  subjective: boolean
  lang: 'es' | 'en' | 'mixed'
  hasMust: boolean
}

function q(
  id: string,
  query: string,
  subjective: boolean,
  lang: HoldoutQuery['lang'],
  hasMust: boolean,
  toolInput?: HoldoutQuery['toolInput']
): HoldoutQuery {
  return { id, query, toolInput, subjective, lang, hasMust }
}

export const HOLDOUT_QUERIES: HoldoutQuery[] = [
  // Spanish subjective and compositional asks
  q(
    'hold-es-bailar-charlar',
    'quiero bailar pero también poder charlar, nada demasiado explotado',
    true,
    'es',
    false,
    { limit: 3 }
  ),
  q('hold-es-cita-bajo-techo', 'un plan tranquilo bajo techo para una cita', true, 'es', false, {
    limit: 3,
  }),
  q('hold-es-padres-sin-ruido', 'algo lindo para hacer con mis viejos, sin mucho ruido', true, 'es', false, {
    limit: 3,
  }),
  q('hold-es-solo-post-laburo', 'salgo solo del laburo y quiero un plan relajado', true, 'es', false, {
    limit: 1,
  }),
  q('hold-es-artistico-no-boliche', 'algo medio artístico y distinto, pero no boliche', true, 'es', false, {
    avoid: ['boliche'],
    limit: 3,
  }),
  q('hold-es-bailar-no-cachengue', 'tres opciones para bailar que no sean cachengue', true, 'es', false, {
    avoid: ['cachengue'],
    limit: 3,
  }),
  q('hold-es-musica-copa-intimo', 'música en vivo con una copa y ambiente íntimo', true, 'es', false, {
    limit: 3,
  }),
  q('hold-es-energia-no-apretado', 'quiero energía pero no estar apretado en un boliche', true, 'es', false, {
    limit: 3,
  }),
  q('hold-es-domingo-calma', 'elegime un plan para arrancar el domingo con calma', true, 'es', false, {
    timeFilter: 'weekend',
    limit: 1,
  }),
  q(
    'hold-es-cita-impresionar-barata',
    'elegime una cita que impresione sin gastar más de veinte mil pesos',
    true,
    'es',
    true,
    { maxPrice: 20000, limit: 1 }
  ),
  q('hold-es-queer-no-megafiesta', 'una salida queer friendly que no sea una mega fiesta', true, 'es', false, {
    limit: 3,
  }),
  q('hold-es-adolescentes', 'tres planes divertidos para ir con dos adolescentes de 15 años', true, 'es', true, {
    minAge: 15,
    limit: 3,
  }),

  // Spanish literal and hard-constraint asks
  q('hold-es-milonga-principiantes', 'milonga para principiantes', false, 'es', false, { limit: 3 }),
  q('hold-es-blues-vivo', 'shows de blues en vivo', false, 'es', false, { limit: 3 }),
  q('hold-es-teatro-almagro', 'teatro independiente en Almagro', false, 'es', true, {
    neighborhoods: ['Almagro'],
    limit: 3,
  }),
  q('hold-es-taller-ceramica', 'talleres de cerámica este fin de semana', false, 'es', true, {
    timeFilter: 'weekend',
    limit: 3,
  }),
  q('hold-es-museo-gratis', 'museos o muestras gratis esta semana', false, 'es', true, {
    isFree: true,
    timeFilter: 'week',
    limit: 3,
  }),
  q('hold-es-feria-comida', 'elegime una feria gastronómica para el domingo', false, 'es', true, {
    timeFilter: 'weekend',
    limit: 1,
  }),
  q('hold-es-rock-indie', 'recitales de rock indie esta semana', false, 'es', true, {
    timeFilter: 'week',
    limit: 3,
  }),
  q('hold-es-standup-barato', 'stand up por menos de quince mil pesos', false, 'es', true, {
    maxPrice: 15000,
    limit: 3,
  }),
  q('hold-es-cine-hoy', 'elegime una función de cine para esta noche', false, 'es', true, {
    timeFilter: 'tonight',
    limit: 1,
  }),
  q('hold-es-palermo-manana-precio', 'cinco eventos en Palermo mañana por menos de veinte mil', false, 'es', true, {
    neighborhoods: ['Palermo'],
    timeFilter: 'tomorrow',
    maxPrice: 20000,
    limit: 5,
  }),
  q('hold-es-recoleta-cultural-gratis', 'planes culturales gratis en Recoleta', false, 'es', true, {
    neighborhoods: ['Recoleta'],
    isFree: true,
    limit: 3,
  }),
  q('hold-es-tango-san-telmo-hoy', 'elegime tango en San Telmo para esta noche', false, 'es', true, {
    neighborhoods: ['San Telmo'],
    timeFilter: 'tonight',
    limit: 1,
  }),

  // English asks
  q('hold-en-warm-quiet-date', 'three warm, quiet date-night options', true, 'en', false, { limit: 3 }),
  q('hold-en-dance-not-huge-club', 'somewhere lively to dance but not a huge packed club', true, 'en', false, {
    limit: 3,
  }),
  q('hold-en-parents-afternoon', 'a relaxed cultural afternoon with my parents', true, 'en', false, {
    limit: 3,
  }),
  q('hold-en-solo-tonight', 'pick one low-pressure thing to do alone tonight', true, 'en', true, {
    timeFilter: 'tonight',
    limit: 1,
  }),
  q('hold-en-live-blues-week', 'live blues shows this week', false, 'en', true, {
    timeFilter: 'week',
    limit: 3,
  }),
  q('hold-en-free-art-weekend', 'five free art workshops this weekend', false, 'en', true, {
    isFree: true,
    timeFilter: 'weekend',
    limit: 5,
  }),
  q('hold-en-comedy-palermo', 'pick a comedy show in Palermo', false, 'en', true, {
    neighborhoods: ['Palermo'],
    limit: 1,
  }),
  q('hold-en-family-tomorrow', 'three family-friendly daytime plans tomorrow for a 12-year-old', true, 'en', true, {
    minAge: 12,
    timeFilter: 'tomorrow',
    limit: 3,
  }),

  // Mixed-language asks
  q('hold-mix-cozy-date', 'algo cozy for a date, no loud party', true, 'mixed', false, { limit: 3 }),
  q('hold-mix-free-palermo-weekend', 'free plans para este weekend en Palermo', false, 'mixed', true, {
    neighborhoods: ['Palermo'],
    isFree: true,
    timeFilter: 'weekend',
    limit: 3,
  }),
  q('hold-mix-dance-talk', 'quiero bailar but somewhere we can talk', true, 'mixed', false, { limit: 3 }),
  q('hold-mix-jazz-cheap-chill', 'live jazz pero barato y tranqui', true, 'mixed', true, {
    maxPrice: 15000,
    limit: 3,
  }),
  q('hold-mix-art-sunday', 'a chill plan con arte para el domingo', true, 'mixed', true, {
    timeFilter: 'weekend',
    limit: 3,
  }),

  // Negation and edge cases
  q('hold-es-musica-no-tributo', 'elegime una sola opción de música que no sea tributo', false, 'es', false, {
    avoid: ['tributo'],
    limit: 1,
  }),
  q('hold-es-aire-libre-lluvia', 'elegime un plan al aire libre, salvo que llueva', true, 'es', false, {
    limit: 1,
  }),
  q('hold-es-no-fiesta-reggaeton', 'tres planes, cualquier cosa menos fiesta o reggaetón', false, 'es', false, {
    avoid: ['fiesta', 'reggaeton'],
    limit: 3,
  }),
]
