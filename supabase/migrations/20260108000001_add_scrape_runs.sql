-- Add scrape_runs table for tracking automated scraping operations
-- and venue_review_queue for low-confidence venue matches

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Scrape run status enum
CREATE TYPE scrape_run_status AS ENUM (
  'running',
  'completed',
  'failed',
  'partial'
);

-- Scrape runs audit table
CREATE TABLE scrape_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identification
  source TEXT NOT NULL,  -- 'passline', 'eventbrite', 'ba-tourism', 'meetup', 'luma', 'all'
  status scrape_run_status NOT NULL DEFAULT 'running',
  trigger_id TEXT,  -- Trigger.dev run ID for debugging

  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  -- Event results
  events_fetched INTEGER DEFAULT 0,
  events_inserted INTEGER DEFAULT 0,
  events_updated INTEGER DEFAULT 0,
  events_skipped INTEGER DEFAULT 0,  -- duplicates, blocked, etc.

  -- Venue results
  venues_matched INTEGER DEFAULT 0,
  venues_auto_created INTEGER DEFAULT 0,
  venues_queued_review INTEGER DEFAULT 0,

  -- Enrichment results
  enrichments_completed INTEGER DEFAULT 0,
  enrichments_failed INTEGER DEFAULT 0,

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  -- Metadata
  metadata JSONB,  -- source-specific stats, config used, date range, etc.

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for querying recent runs
CREATE INDEX idx_scrape_runs_source_started ON scrape_runs (source, started_at DESC);
CREATE INDEX idx_scrape_runs_status ON scrape_runs (status);
CREATE INDEX idx_scrape_runs_started_at ON scrape_runs (started_at DESC);

-- Venue review queue for low-confidence matches
CREATE TABLE venue_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_run_id UUID REFERENCES scrape_runs(id) ON DELETE CASCADE,

  -- Source data
  source TEXT NOT NULL,  -- 'passline', 'eventbrite', 'ba-tourism', 'meetup', 'luma'
  source_venue_name TEXT NOT NULL,
  source_address TEXT,
  source_coordinates JSONB,  -- {lat: number, lng: number}
  source_event_ids UUID[],  -- Events associated with this venue

  -- Fuzzy match results
  best_match_venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  match_confidence DECIMAL(3, 2),  -- 0.00 to 1.00

  -- Review status
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected', 'merged'
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Final decision
  final_venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for venue review queue
CREATE INDEX idx_venue_review_queue_status ON venue_review_queue (status);
CREATE INDEX idx_venue_review_queue_source ON venue_review_queue (source);
CREATE INDEX idx_venue_review_queue_scrape_run ON venue_review_queue (scrape_run_id);
CREATE INDEX idx_venue_review_queue_created ON venue_review_queue (created_at DESC);

-- Enable RLS
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_review_queue ENABLE ROW LEVEL SECURITY;

-- Policies: Only admins can read/write
CREATE POLICY "Admins can read scrape_runs" ON scrape_runs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Service role can insert scrape_runs" ON scrape_runs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update scrape_runs" ON scrape_runs
  FOR UPDATE
  USING (true);

CREATE POLICY "Admins can read venue_review_queue" ON venue_review_queue
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Service role can insert venue_review_queue" ON venue_review_queue
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can update venue_review_queue" ON venue_review_queue
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER update_venue_review_queue_updated_at
  BEFORE UPDATE ON venue_review_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comment on tables
COMMENT ON TABLE scrape_runs IS 'Audit trail for automated and manual scraping operations';
COMMENT ON TABLE venue_review_queue IS 'Queue of venues with low-confidence matches needing admin review';
