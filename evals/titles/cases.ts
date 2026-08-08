#!/usr/bin/env bun
/** Titles eval cases: realistic first messages, both locales. */
export interface TitleCase {
  id: string
  firstMessage: string
  locale: 'en' | 'es'
}

export const TITLE_CASES: TitleCase[] = [
  { id: 'en-tonight-palermo', firstMessage: "what's on tonight in Palermo?", locale: 'en' },
  { id: 'en-techno-weekend', firstMessage: 'any good techno this weekend?', locale: 'en' },
  { id: 'en-romantic', firstMessage: 'romantic dinner ideas for Saturday', locale: 'en' },
  { id: 'en-free-jazz', firstMessage: 'free jazz events in the city', locale: 'en' },
  { id: 'en-tango', firstMessage: 'tango classes for total beginners', locale: 'en' },
  { id: 'en-football', firstMessage: 'where can I watch the Boca match this Sunday?', locale: 'en' },
  { id: 'en-kids', firstMessage: 'something fun to do with kids this weekend', locale: 'en' },
  { id: 'en-warehouse', firstMessage: 'underground warehouse party vibes, what do you have?', locale: 'en' },
  { id: 'es-hoy-noche', firstMessage: '¿qué hay para hacer hoy a la noche?', locale: 'es' },
  { id: 'es-gratis-palermo', firstMessage: 'eventos gratis en Palermo este finde', locale: 'es' },
  { id: 'es-romantico', firstMessage: 'algo romántico para el sábado con mi novia', locale: 'es' },
  { id: 'es-tango', firstMessage: 'clases de tango para principiantes', locale: 'es' },
  { id: 'es-teatro', firstMessage: '¿hay algo de teatro este fin de semana?', locale: 'es' },
  { id: 'es-conciertos', firstMessage: 'qué conciertos hay esta semana', locale: 'es' },
  { id: 'es-chicos', firstMessage: 'actividades para hacer con chicos el domingo', locale: 'es' },
  { id: 'es-ferias', firstMessage: 'ferias de comida este mes en la ciudad', locale: 'es' },
]
