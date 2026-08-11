// Events Feature - Public API
// This is the public interface for the events feature.
// Import from '@/features/events' instead of reaching into internal modules.
//
// The admin event management UI was removed (agents operate the site); only
// the public-facing server functions remain.

// API (Server Functions)
export {
  getTrendingEventsAction,
  getEventWithVenueAction,
} from './api/crud'
