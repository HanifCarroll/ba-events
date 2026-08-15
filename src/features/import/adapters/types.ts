/**
 * Import Source Types
 *
 * Shared types for the import feature. The manual import wizard was removed
 * (agents drive imports via the automated Trigger.dev pipeline), so only the
 * types still consumed by the pipeline remain here.
 */

// All supported import sources
export type ImportSource = 'passline' | 'eventbrite' | 'ba-tourism' | 'meetup' | 'luma' | 'venti' | 'csv'

// Re-export DuplicateInfo for convenience
export type { DuplicateInfo } from '../api/duplicate-detection.ts'
