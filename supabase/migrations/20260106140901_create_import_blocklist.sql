-- Create import_blocklist table for filtering advertisement events during import
-- Part of the DB-backed blocklist feature replacing static config

CREATE TABLE import_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern text NOT NULL,
  target_field text NOT NULL CHECK (target_field IN ('event_name', 'venue_name')),
  source text NOT NULL CHECK (source IN ('passline', 'eventbrite', 'ba_tourism', 'meetup', 'luma', 'all')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient filtering by source
CREATE INDEX idx_import_blocklist_source ON import_blocklist(source);

-- Auto-update updated_at timestamp
CREATE TRIGGER import_blocklist_updated_at
  BEFORE UPDATE ON import_blocklist
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Comments for documentation
COMMENT ON TABLE import_blocklist IS 'Blocklist entries for filtering advertisement events during import';
COMMENT ON COLUMN import_blocklist.pattern IS 'Text pattern to match (case-insensitive substring match)';
COMMENT ON COLUMN import_blocklist.target_field IS 'Which field to match against: event_name or venue_name';
COMMENT ON COLUMN import_blocklist.source IS 'Import source to apply this rule to, or all for all sources';
COMMENT ON COLUMN import_blocklist.reason IS 'Optional explanation for why this pattern is blocked';

-- RLS policies
ALTER TABLE import_blocklist ENABLE ROW LEVEL SECURITY;

-- Anyone can read blocklist entries (needed for filtering during import)
CREATE POLICY "Anyone can read blocklist entries"
  ON import_blocklist FOR SELECT
  USING (true);

-- Only admins can insert/update/delete
CREATE POLICY "Admins can insert blocklist entries"
  ON import_blocklist FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update blocklist entries"
  ON import_blocklist FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete blocklist entries"
  ON import_blocklist FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );
