/**
 * Hook to migrate anonymous conversations to authenticated user on login/signup.
 *
 * Runs once after successful authentication if local conversations exist.
 * Migrates all IndexedDB conversations to PostgreSQL and clears local storage.
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthContext } from './useAuthContext'
import { toast } from 'sonner'
import {
  hasLocalConversations,
  getConversationsForMigration,
  clearLocalConversations,
} from '@/shared/lib/db/local-conversations'
import { migrateConversations } from '@/features/chat/api/conversations'
import { queryKeys } from '@/shared/lib/query'

/**
 * Call this hook in the root layout or auth provider.
 * It will automatically migrate local conversations when a user logs in.
 */
export function useMigrateOnLogin() {
  const { user, loading } = useAuthContext()
  const queryClient = useQueryClient()
  const hasMigratedRef = useRef(false)

  useEffect(() => {
    // Don't run while loading or if already migrated this session
    if (loading || hasMigratedRef.current) return

    // Only run for authenticated users
    if (!user) return

    // Mark as migrated to prevent re-running
    hasMigratedRef.current = true

    // Run migration async
    async function migrate() {
      try {
        // Check if there are local conversations to migrate
        const hasLocal = await hasLocalConversations()
        if (!hasLocal) {
          return
        }

        // Get all conversations for migration
        const conversations = await getConversationsForMigration()
        if (conversations.length === 0) {
          return
        }

        // Migrate to server
        const result = await migrateConversations({ data: { conversations } })

        // Clear local storage on success
        if (result.imported > 0) {
          await clearLocalConversations()

          // Invalidate conversations query to refresh the list
          queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })

          // Show success toast
          toast.success(`Imported ${result.imported} conversation${result.imported > 1 ? 's' : ''} from previous session`)
        }
      } catch (error) {
        console.error('[useMigrateOnLogin] Migration failed:', error)
        // Don't show error toast - silent failure is better UX
        // User can still see their local conversations if they log out
      }
    }

    migrate()
  }, [user, loading, queryClient])
}
