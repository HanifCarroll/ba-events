import { franc } from 'franc-min'

export const REPLY_LANGUAGE_VERSION = 'franc-min-6.2.0-en-es-v1'

/** This bilingual check is not a validator for all languages or mixed prose. */
export function detectReplyLanguage(text: string): 'en' | 'es' | 'unknown' {
  const language = franc(text, { only: ['eng', 'spa'] })
  if (language === 'eng') return 'en'
  if (language === 'spa') return 'es'
  return 'unknown'
}
