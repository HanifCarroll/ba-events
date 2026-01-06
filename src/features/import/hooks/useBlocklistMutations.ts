/**
 * React Query mutation hooks for import blocklist operations
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createBlocklistEntryAction,
  updateBlocklistEntryAction,
  deleteBlocklistEntryAction,
  bulkDeleteBlocklistEntriesAction,
} from '../api/blocklist'
import { queryKeys } from '@/shared/lib/query'
import { getErrorMessage } from '@/shared/lib/error-messages'
import type {
  ImportBlocklistEntry,
  ImportBlocklistEntryInsert,
  ImportBlocklistEntryUpdate,
} from '@/shared/lib/types'

export function useCreateBlocklistEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: ImportBlocklistEntryInsert) => createBlocklistEntryAction({ data }),
    onSuccess: (newEntry) => {
      // Add new entry to cache directly
      queryClient.setQueriesData<ImportBlocklistEntry[]>(
        { queryKey: queryKeys.blocklist.all },
        (old) => (old ? [newEntry, ...old] : [newEntry])
      )
      toast.success('Blocklist entry created')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'create', entity: 'blocklist entry' }))
    },
  })
}

export function useUpdateBlocklistEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ImportBlocklistEntryUpdate }) =>
      updateBlocklistEntryAction({ data: { id, data } }),
    onSuccess: (updatedEntry, variables) => {
      // Update entry in cache directly
      queryClient.setQueriesData<ImportBlocklistEntry[]>(
        { queryKey: queryKeys.blocklist.all },
        (old) => old?.map((e) => (e.id === variables.id ? { ...e, ...updatedEntry } : e))
      )
      // Update detail cache if it exists
      queryClient.setQueryData<ImportBlocklistEntry>(
        queryKeys.blocklist.detail(variables.id),
        (old) => (old ? { ...old, ...updatedEntry } : undefined)
      )
      toast.success('Blocklist entry updated')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'update', entity: 'blocklist entry' }))
    },
  })
}

export function useDeleteBlocklistEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteBlocklistEntryAction({ data: id }),
    onSuccess: (_, entryId) => {
      // Remove from cache directly
      queryClient.setQueriesData<ImportBlocklistEntry[]>(
        { queryKey: queryKeys.blocklist.all },
        (old) => old?.filter((e) => e.id !== entryId)
      )
      toast.success('Blocklist entry deleted')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'delete', entity: 'blocklist entry' }))
    },
  })
}

export function useBulkDeleteBlocklistEntries() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ids: string[]) => bulkDeleteBlocklistEntriesAction({ data: ids }),
    onSuccess: (result, ids) => {
      const idSet = new Set(ids)
      // Remove from cache directly
      queryClient.setQueriesData<ImportBlocklistEntry[]>(
        { queryKey: queryKeys.blocklist.all },
        (old) => old?.filter((e) => !idSet.has(e.id))
      )
      toast.success(`Deleted ${result.count} blocklist entries`)
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'delete', entity: 'blocklist entries' }))
    },
  })
}
