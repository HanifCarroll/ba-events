/**
 * Import Source Types
 *
 * Shared types for the import feature. The manual import wizard was removed
 * (agents drive imports via the scheduled jobs Worker), so only the
 * types still consumed by the pipeline remain here.
 */

// All supported import sources
export type ImportSource = 'ba-tourism' | 'meetup' | 'luma' | 'instagram' | 'csv'

// Re-export DuplicateInfo for convenience
export type { DuplicateInfo } from '../api/duplicate-detection.ts'
