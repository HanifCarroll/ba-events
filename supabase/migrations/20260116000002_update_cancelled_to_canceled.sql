-- Migration: Update existing 'cancelled' events to 'canceled'
-- This is step 2 - runs after the enum value was added in step 1

UPDATE events SET status = 'canceled' WHERE status = 'cancelled';
