-- Performance indexes for common query patterns
-- These improve response times for event searches and filtering

-- Composite index for time-range queries (most common pattern)
-- Used by getTonightsEvents, getWeekendEvents, and date-filtered searches
CREATE INDEX  IF NOT EXISTS idx_events_status_starts_at
ON events (status, starts_at) WHERE status = 'scheduled';

-- Neighborhood filtering (used in chat searches)
-- Note: events_with_venues is a view, so index the underlying tables
CREATE INDEX  IF NOT EXISTS idx_venues_neighborhood
ON venues (neighborhood);

-- Categories array search using GIN for efficient containment queries
CREATE INDEX  IF NOT EXISTS idx_events_categories_gin
ON events USING GIN (categories);

-- Free events filter (common chat query)
CREATE INDEX  IF NOT EXISTS idx_events_is_free
ON events (is_free) WHERE is_free = true AND status = 'scheduled';
