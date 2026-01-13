// Chat Feature - Public API
// This is the public interface for the chat feature.
// Import from '@/features/chat' instead of reaching into internal modules.

// Suggestions generator (used by API route)
export { generateSuggestions } from './api/suggestions'
export type { SuggestionContext } from './api/suggestions'

// Message utilities
export {
  generateId,
  createUserMessage,
  createAssistantMessage,
  parseUserIntent,
  intentToFilters,
  generateResponse,
  formatPrice,
  formatEventTime,
  getFavorites,
  addFavorite,
  removeFavorite,
  isFavorite,
  toggleFavorite,
} from './lib/messages'

// Saved events
export {
  getSavedEvents,
  getSavedEventIds,
  saveEvent,
  unsaveEvent,
  isEventSaved,
} from './lib/saved'
