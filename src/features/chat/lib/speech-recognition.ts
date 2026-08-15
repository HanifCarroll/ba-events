/**
 * Minimal Web Speech API (SpeechRecognition) bindings.
 *
 * TypeScript's DOM lib doesn't ship SpeechRecognition types, so we declare
 * just the surface the chat input uses. See MDN for the full API:
 * https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
 *
 * Two recognition modes exist:
 * - `cloud`: audio is streamed to the browser vendor's service (Google on
 *   Chrome/Edge, Apple on Safari). No audio leaves the device for `on-device`.
 * - `on-device`: Chrome 139+ desktop only. `processLocally = true` plus a
 *   one-time language-pack download via `available()`/`install()`; recognition
 *   runs entirely on the device, works offline, and sends nothing to a server.
 *
 * Progressive strategy (see getRecognitionMode): prefer on-device when the
 * browser exposes it, fall back to cloud everywhere else (Safari, older
 * Chrome/Edge), and report `unsupported` where neither exists (Firefox ships
 * recognition only behind a flag, off by default).
 */

import { browser } from '$app/env'

export interface SpeechRecognitionAlternativeLike {
  transcript: string
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternativeLike
}

export interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

export interface SpeechRecognitionErrorLike {
  error: string
}

export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  processLocally?: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface RecognitionAvailabilityOptions {
  langs: string[]
  processLocally?: boolean
  quality?: 'default' | 'dictation'
}

type AvailabilityStatus = 'available' | 'unavailable' | 'downloadable' | 'downloading'

interface SpeechRecognitionStaticLike {
  available?(options: RecognitionAvailabilityOptions): Promise<AvailabilityStatus>
  install?(options: RecognitionAvailabilityOptions): Promise<boolean>
}

export type RecognitionMode = 'on-device' | 'cloud' | 'unsupported'

function getCtor(): SpeechRecognitionCtor | null {
  if (!browser) return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Resolve which recognition mode the current browser supports.
 * Browser-level capability — independent of the chosen language.
 */
export function getRecognitionMode(): RecognitionMode {
  const Ctor = getCtor()
  if (!Ctor) return 'unsupported'
  const staticApi = Ctor as unknown as SpeechRecognitionStaticLike
  // On-device path ships together in Chrome 139+ (desktop): instance
  // `processLocally` plus static `available()`/`install()`.
  if (typeof staticApi.available === 'function' && typeof staticApi.install === 'function') {
    return 'on-device'
  }
  return 'cloud'
}

export function createSpeechRecognition(
  lang: string,
  mode: RecognitionMode,
): SpeechRecognitionLike | null {
  const Ctor = getCtor()
  if (!Ctor || mode === 'unsupported') return null
  const recognition = new Ctor()
  recognition.lang = lang
  recognition.interimResults = true
  recognition.continuous = false
  recognition.maxAlternatives = 1
  if (mode === 'on-device') {
    recognition.processLocally = true
  }
  return recognition
}

export interface LanguagePackResult {
  /** True when the language pack is (or was just made) available for on-device use. */
  ok: boolean
  /** True when on-device recognition can't be used and cloud should be used instead. */
  fallbackToCloud: boolean
}

/**
 * Ensure the on-device language pack for `lang` is installed.
 * Fails soft: any missing capability or unknown language reports
 * `fallbackToCloud: true` so the caller can transparently degrade to cloud.
 */
export async function ensureOnDeviceLanguagePack(
  lang: string,
): Promise<LanguagePackResult> {
  const Ctor = getCtor()
  if (!Ctor) return { ok: false, fallbackToCloud: true }
  const staticApi = Ctor as unknown as SpeechRecognitionStaticLike
  if (typeof staticApi.available !== 'function' || typeof staticApi.install !== 'function') {
    return { ok: false, fallbackToCloud: true }
  }
  try {
    const status = await staticApi.available({
      langs: [lang],
      processLocally: true,
      quality: 'dictation',
    })
    if (status === 'available') return { ok: true, fallbackToCloud: false }
    // Language pack not supported at all → use cloud recognition.
    if (status === 'unavailable') return { ok: false, fallbackToCloud: true }
    // 'downloadable' or 'downloading' → install it.
    const installed = await staticApi.install({
      langs: [lang],
      processLocally: true,
      quality: 'dictation',
    })
    return { ok: installed, fallbackToCloud: !installed }
  } catch {
    return { ok: false, fallbackToCloud: true }
  }
}
