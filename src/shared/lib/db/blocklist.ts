/**
 * Database client functions for import blocklist
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from './client'
import type {
  ImportBlocklistEntry,
  ImportBlocklistEntryInsert,
  ImportBlocklistEntryUpdate,
  BlocklistSource,
} from '../types'

/**
 * Get all blocklist entries, optionally filtered by source
 * When filtering by source, includes entries with source='all'
 */
export async function getBlocklistEntries(source?: BlocklistSource) {
  let query = getSupabase()
    .from('import_blocklist')
    .select('*')
    .order('created_at', { ascending: false })

  if (source && source !== 'all') {
    // Include entries for the specific source AND entries for 'all'
    query = query.or(`source.eq.${source},source.eq.all`)
  }

  const { data, error } = await query

  if (error) throw error
  return data as ImportBlocklistEntry[]
}

/**
 * Get a single blocklist entry by ID
 */
export async function getBlocklistEntryById(id: string) {
  const { data, error } = await getSupabase()
    .from('import_blocklist')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as ImportBlocklistEntry
}

/**
 * Create a new blocklist entry
 */
export async function createBlocklistEntry(
  entry: ImportBlocklistEntryInsert,
  client?: SupabaseClient
) {
  const db = client ?? getSupabase()
  const { data, error } = await db
    .from('import_blocklist')
    .insert(entry)
    .select()
    .single()

  if (error) throw error
  return data as ImportBlocklistEntry
}

/**
 * Update an existing blocklist entry
 */
export async function updateBlocklistEntry(
  id: string,
  updates: ImportBlocklistEntryUpdate,
  client?: SupabaseClient
) {
  const db = client ?? getSupabase()
  const { data, error } = await db
    .from('import_blocklist')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as ImportBlocklistEntry
}

/**
 * Delete a blocklist entry
 */
export async function deleteBlocklistEntry(id: string, client?: SupabaseClient) {
  const db = client ?? getSupabase()
  const { error } = await db.from('import_blocklist').delete().eq('id', id)
  if (error) throw error
}

/**
 * Bulk delete blocklist entries
 */
export async function bulkDeleteBlocklistEntries(ids: string[], client?: SupabaseClient) {
  const db = client ?? getSupabase()
  const { error } = await db.from('import_blocklist').delete().in('id', ids)
  if (error) throw error
}
