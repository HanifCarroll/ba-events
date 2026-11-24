export const GUEST_DEBUG_FORMAT_VERSION = 1

/** Legacy arrays allowed client-supplied trace fields; only versioned rows attest to trace ownership. */
export function isServerGuestTranscript(value: unknown): value is { version: typeof GUEST_DEBUG_FORMAT_VERSION; messages: unknown[] } {
  return !!value && typeof value === 'object' && 'version' in value && value.version === GUEST_DEBUG_FORMAT_VERSION &&
    'messages' in value && Array.isArray(value.messages)
}
