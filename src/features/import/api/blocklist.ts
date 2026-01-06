/**
 * Server functions for import blocklist CRUD operations
 */

import { createServerFn } from '@tanstack/react-start'
import {
  getBlocklistEntries,
  getBlocklistEntryById,
  createBlocklistEntry,
  updateBlocklistEntry,
  deleteBlocklistEntry,
  bulkDeleteBlocklistEntries,
} from '@/shared/lib/db/blocklist'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import type {
  ImportBlocklistEntryInsert,
  ImportBlocklistEntryUpdate,
  BlocklistSource,
} from '@/shared/lib/types'

/**
 * List all blocklist entries, optionally filtered by source
 */
export const listBlocklistEntriesAction = createServerFn({ method: 'GET' })
  .inputValidator((source?: BlocklistSource) => source)
  .handler(async ({ data: source }) => {
    return getBlocklistEntries(source)
  })

/**
 * Get a single blocklist entry by ID
 */
export const getBlocklistEntryAction = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    return getBlocklistEntryById(id)
  })

/**
 * Create a new blocklist entry (admin only)
 */
export const createBlocklistEntryAction = createServerFn({ method: 'POST' })
  .inputValidator((data: ImportBlocklistEntryInsert) => data)
  .handler(async ({ data }) => {
    const client = await requireAdminAccess()
    return createBlocklistEntry(data, client)
  })

/**
 * Update an existing blocklist entry (admin only)
 */
export const updateBlocklistEntryAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; data: ImportBlocklistEntryUpdate }) => input)
  .handler(async ({ data: { id, data } }) => {
    const client = await requireAdminAccess()
    return updateBlocklistEntry(id, data, client)
  })

/**
 * Delete a blocklist entry (admin only)
 */
export const deleteBlocklistEntryAction = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const client = await requireAdminAccess()
    await deleteBlocklistEntry(id, client)
    return { success: true }
  })

/**
 * Bulk delete blocklist entries (admin only)
 */
export const bulkDeleteBlocklistEntriesAction = createServerFn({ method: 'POST' })
  .inputValidator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const client = await requireAdminAccess()
    await bulkDeleteBlocklistEntries(ids, client)
    return { success: true, count: ids.length }
  })
