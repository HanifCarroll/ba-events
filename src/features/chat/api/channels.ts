/** Persisted channel IDs. Keep these values in sync with the D1 conversation CHECK constraints. */
export const EXTERNAL_CHANNEL = { telegram: 'telegram' } as const

export const CONVERSATION_CHANNELS = ['web', ...Object.values(EXTERNAL_CHANNEL)] as const

export type ExternalChannel = (typeof EXTERNAL_CHANNEL)[keyof typeof EXTERNAL_CHANNEL]
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number]
