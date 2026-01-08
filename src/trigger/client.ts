/**
 * Trigger.dev Client Configuration
 *
 * This client is used to define and run scheduled jobs for automated scraping.
 */
import { configure } from '@trigger.dev/sdk/v3'

// Configure Trigger.dev
configure({
  secretKey: process.env.TRIGGER_SECRET_KEY,
})

// Project ID for reference in jobs
export const TRIGGER_PROJECT_ID = 'ba-events'
