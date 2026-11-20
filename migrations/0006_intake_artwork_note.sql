ALTER TABLE intake_plans ADD COLUMN artwork_note TEXT CHECK (length(artwork_note) <= 300);
