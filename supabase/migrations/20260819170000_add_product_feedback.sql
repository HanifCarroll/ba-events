-- Feedback is first-party product data, never analytics data. Only server-side
-- service-role code may write or read it.
CREATE TABLE product_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE product_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages product feedback"
  ON product_feedback FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

COMMENT ON TABLE product_feedback IS
  'User-submitted feedback stored outside product analytics.';
