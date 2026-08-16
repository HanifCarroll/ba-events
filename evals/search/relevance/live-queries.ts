#!/usr/bin/env bun
/**
 * Live-catalog graded queries for the conclusive rerank eval.
 *
 * Unlike queries.ts (pinned fixture corpus), these run against a live capture:
 * evals/search/relevance/capture.ts freezes production-path candidates and
 * Voyage ranks; replay.ts scores variants offline against LIVE_LABELS.
 *
 * Slice tags drive the per-slice report:
 *   subjective — soft vibe/compositional ask (the reranker's claimed home turf)
 *   lang       — query language
 *   hasMust    — carries a hard constraint (free/neighborhood/price/date/age)
 */

import type { SearchEventsInput } from '#features/chat/api/tools/search-events.ts'

export interface LiveQuery {
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
  lang: LiveQuery['lang'],
  hasMust: boolean,
  toolInput?: LiveQuery['toolInput']
): LiveQuery {
  return { id, query, toolInput, subjective, lang, hasMust }
}

export const LIVE_QUERIES: LiveQuery[] = [
  // ------------------------------------------------------------------
  // SUBJECTIVE / VIBE — Spanish
  // ------------------------------------------------------------------
  q('vibe-tranqui-hoy', 'algo tranqui para hoy a la noche', true, 'es', false),
  q('vibe-cita-romantica', 'una cita romántica este finde', true, 'es', false),
  q('vibe-chill-amigos', 'algo chill para ir con amigos', true, 'es', false),
  q('vibe-bailar-tarde', 'donde puedo bailar hasta tarde', true, 'es', false),
  q('vibe-under', 'algo under, nada cheto', true, 'es', false),
  q('vibe-cultural-relajado', 'un plan cultural pero relajado', true, 'es', false),
  q('vibe-jazz-cita', 'jazz tranqui para una primera cita', true, 'es', false),
  q('vibe-desconectar', 'algo para desconectar después del laburo', true, 'es', false),
  q('vibe-bar-charlar', 'un bar íntimo para charlar', true, 'es', false),
  q('vibe-fiesta-suave', 'fiesta pero no tan cargosa', true, 'es', false),
  q('vibe-distinto', 'algo distinto, no lo de siempre', true, 'es', false),
  q('vibe-impresionar', 'un plan para impresionar a alguien que visita', true, 'es', false),
  q('vibe-wellness', 'algo wellness el domingo a la mañana', true, 'es', false),
  q('vibe-reir', 'stand up para reírme un rato', true, 'es', false),
  q('vibe-familiar', 'un plan familiar para el domingo', true, 'es', false),

  // ------------------------------------------------------------------
  // SUBJECTIVE / VIBE — English
  // ------------------------------------------------------------------
  q('vibe-en-lowkey', 'something low-key tonight', true, 'en', false),
  q('vibe-en-date-night', 'a fun date night idea', true, 'en', false),
  q('vibe-en-underground-techno', 'an underground techno night', true, 'en', false),
  q('vibe-en-chill-sunday', 'a chill sunday plan', true, 'en', false),
  q('vibe-en-talk', 'somewhere I can actually talk and hear my friends', true, 'en', false),
  q('vibe-en-big-night', 'a big night out with friends', true, 'en', false),
  q('vibe-en-cultural', 'something cultural but not boring', true, 'en', false),
  q('vibe-en-cozy-jazz', 'live jazz in a cozy spot', true, 'en', false),
  q('vibe-en-dancing', "what's good for dancing this weekend", true, 'en', false),
  q('vibe-en-relaxed-afternoon', 'a relaxed afternoon plan', true, 'en', false),

  // ------------------------------------------------------------------
  // LITERAL — genre / category, Spanish
  // ------------------------------------------------------------------
  q('lit-rock', 'conciertos de rock', false, 'es', false),
  q('lit-techno-finde', 'techno este finde', false, 'es', false, { timeFilter: 'weekend' }),
  q('lit-reggaeton', 'reggaeton', false, 'es', false),
  q('lit-tango', 'tango', false, 'es', false),
  q('lit-cumbia', 'cumbia', false, 'es', false),
  q('lit-standup', 'stand up', false, 'es', false),
  q('lit-folklore', 'folklore', false, 'es', false),
  q('lit-clasica', 'música clásica', false, 'es', false),
  q('lit-hiphop', 'hip hop', false, 'es', false),
  q('lit-retro', 'fiesta retro ochenta', false, 'es', false),

  // ------------------------------------------------------------------
  // LITERAL — English
  // ------------------------------------------------------------------
  q('lit-en-jazz', 'jazz concerts', false, 'en', false),
  q('lit-en-house', 'house music parties', false, 'en', false),
  q('lit-en-art', 'art exhibitions', false, 'en', false),
  q('lit-en-comedy', 'comedy shows', false, 'en', false),
  q('lit-en-food', 'food events', false, 'en', false),
  q('lit-en-yoga', 'yoga or wellness events', false, 'en', false),
  q('lit-en-sports', 'sports this weekend', false, 'en', false, { timeFilter: 'weekend' }),
  q('lit-en-theater', 'theater plays', false, 'en', false),
  q('lit-en-film', 'film screenings', false, 'en', false),
  q('lit-en-workshop', 'workshops', false, 'en', false),

  // ------------------------------------------------------------------
  // HARD CONSTRAINTS
  // ------------------------------------------------------------------
  q('must-gratis-finde', 'eventos gratis este finde', false, 'es', true, { isFree: true, timeFilter: 'weekend' }),
  q('must-gratis-hoy', 'algo gratis hoy', false, 'es', true, { isFree: true }),
  q('must-palermo-fiesta', 'fiestas en Palermo', false, 'es', true, { neighborhoods: ['Palermo'] }),
  q('must-techno-palermo', 'techno en Palermo este finde', false, 'es', true, { neighborhoods: ['Palermo'], timeFilter: 'weekend' }),
  q('must-san-telmo', 'algo en San Telmo', false, 'es', true, { neighborhoods: ['San Telmo'] }),
  q('must-recoleta', 'planes en Recoleta', false, 'es', true, { neighborhoods: ['Recoleta'] }),
  q('must-jazz-palermo', 'jazz en Palermo', false, 'es', true, { neighborhoods: ['Palermo'] }),
  q('must-gratis-palermo', 'eventos gratis en Palermo', false, 'es', true, { isFree: true, neighborhoods: ['Palermo'] }),
  q('must-barato', 'algo de menos de 10000 pesos', false, 'es', true, { maxPrice: 10000 }),
  q('must-manana', 'qué hay mañana', false, 'es', true, { timeFilter: 'tomorrow' }),
  q('must-esta-noche', 'qué hay esta noche', false, 'es', true, { timeFilter: 'tonight' }),
  q('must-menor', 'puedo ir con mi hermano de 16 años a algo?', false, 'es', true, { minAge: 16 }),
  q('must-aire-libre', 'eventos al aire libre', true, 'es', false),
  q('must-chacarita', 'algo en Chacarita', false, 'es', true, { neighborhoods: ['Chacarita'] }),
  q('must-semana', 'conciertos esta semana', false, 'es', true, { timeFilter: 'week' }),

  // ------------------------------------------------------------------
  // AVOID / NEGATION
  // ------------------------------------------------------------------
  q('avoid-reggaeton', 'algo de música pero que no sea reggaeton', false, 'es', false, { avoid: ['reggaeton'] }),
  q('avoid-cachengue', 'fiesta pero sin cachengue', true, 'es', false),
  q('avoid-techno', 'cualquier cosa menos techno', false, 'es', false, { avoid: ['techno'] }),
  q('avoid-tributos', 'rock pero no bandas tributo', false, 'es', false),
  q('avoid-joda', 'algo tranqui, nada de joda', true, 'es', false),

  // ------------------------------------------------------------------
  // BILINGUAL / MIXED
  // ------------------------------------------------------------------
  q('mix-tranqui-tonight', 'something tranqui tonight', true, 'mixed', false),
  q('mix-fiesta-not-crazy', 'una fiesta but not too crazy', true, 'mixed', false),
  q('mix-free-finde', 'free events este finde', false, 'mixed', true, { isFree: true, timeFilter: 'weekend' }),
  q('mix-jazz-palermo', 'jazz pero en Palermo', false, 'mixed', true, { neighborhoods: ['Palermo'] }),
  q('mix-piola-hoy', 'algo piola para hoy', true, 'es', false),

  // ------------------------------------------------------------------
  // SLANG / TYPO / COLLOQUIAL
  // ------------------------------------------------------------------
  q('slang-joda', 'joda este finde', true, 'es', false, { timeFilter: 'weekend' }),
  q('slang-cachengue', 'cachengue', false, 'es', false),
  q('slang-cita-piola', 'algo piola para una cita', true, 'es', false),
  q('slang-musica-vivo', 'musica en vivo', false, 'es', false),
  q('slang-sabado', 'que hay el sabado', false, 'es', true, { timeFilter: 'weekend' }),
  q('slang-after-office', 'after office', false, 'es', false),
  q('slang-previa', 'previa con amigos', true, 'es', false),
  q('slang-boliche', 'boliche', false, 'es', false),
  q('slang-merienda', 'una merienda distinta', false, 'es', false),

  // ------------------------------------------------------------------
  // SPARSE / NO-MATCH PROBES
  // ------------------------------------------------------------------
  q('sparse-opera', 'ópera', false, 'es', false),
  q('sparse-ajedrez', 'torneo de ajedrez', false, 'es', false),
  q('sparse-salsa', 'clases de salsa', false, 'es', false),
  q('sparse-metal', 'heavy metal', false, 'es', false),
  q('sparse-poesia', 'poesía o spoken word', false, 'es', false),

  // ------------------------------------------------------------------
  // GENERIC DISCOVERY
  // ------------------------------------------------------------------
  q('disc-finde', 'qué hay este fin de semana', false, 'es', true, { timeFilter: 'weekend' }),
  q('disc-hoy-noche', 'qué hacemos hoy a la noche', false, 'es', true, { timeFilter: 'tonight' }),
  q('disc-mejores-fiestas', 'las mejores fiestas del finde', true, 'es', false, { timeFilter: 'weekend' }),
  q('disc-algo-hoy', 'algo para hoy', false, 'es', false),
  q('disc-en-this-weekend', "what's on this weekend", false, 'en', true, { timeFilter: 'weekend' }),
]
