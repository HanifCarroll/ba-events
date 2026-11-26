export type LandingPromptHints = { eventId?: string; happeningSoonEventIds: string[] }

export type LandingPromptHandler = (prompt: string, options: LandingPromptHints) => void
