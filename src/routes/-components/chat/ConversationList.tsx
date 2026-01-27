import { useMemo } from 'react'
import {
  isToday,
  isYesterday,
  isWithinInterval,
  subDays,
  startOfDay,
  endOfDay,
} from 'date-fns'
import { ConversationItem } from './ConversationItem'
import type { ConversationListItem } from '@/shared/lib/types'

interface ConversationListProps {
  conversations: ConversationListItem[]
  activeConversationId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  /** Current search query for empty state messaging */
  searchQuery?: string
}

interface GroupedConversations {
  today: ConversationListItem[]
  yesterday: ConversationListItem[]
  previous7Days: ConversationListItem[]
  older: ConversationListItem[]
}

/**
 * Time-grouped list of conversations.
 * Groups: Today, Yesterday, Previous 7 Days, Older
 */
export function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onRename,
  onDelete,
  searchQuery,
}: ConversationListProps) {
  // Group conversations by time
  const grouped = useMemo((): GroupedConversations => {
    const now = new Date()
    const sevenDaysAgo = subDays(startOfDay(now), 7)
    const twoDaysAgo = subDays(startOfDay(now), 2)

    const result: GroupedConversations = {
      today: [],
      yesterday: [],
      previous7Days: [],
      older: [],
    }

    for (const conv of conversations) {
      const date = new Date(conv.updated_at)

      if (isToday(date)) {
        result.today.push(conv)
      } else if (isYesterday(date)) {
        result.yesterday.push(conv)
      } else if (
        isWithinInterval(date, {
          start: sevenDaysAgo,
          end: endOfDay(twoDaysAgo),
        })
      ) {
        result.previous7Days.push(conv)
      } else {
        result.older.push(conv)
      }
    }

    return result
  }, [conversations])

  if (conversations.length === 0) {
    // Different message for search vs no conversations
    const isSearching = searchQuery && searchQuery.trim().length > 0
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        {isSearching ? (
          <p className="text-sm text-muted-foreground text-center">
            No results for "{searchQuery}"
            <br />
            <span className="text-xs">Try different keywords</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground text-center">
            No conversations yet.
            <br />
            Start chatting to see your history here.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {grouped.today.length > 0 && (
        <ConversationGroup
          title="Today"
          conversations={grouped.today}
          activeConversationId={activeConversationId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}

      {grouped.yesterday.length > 0 && (
        <ConversationGroup
          title="Yesterday"
          conversations={grouped.yesterday}
          activeConversationId={activeConversationId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}

      {grouped.previous7Days.length > 0 && (
        <ConversationGroup
          title="Previous 7 Days"
          conversations={grouped.previous7Days}
          activeConversationId={activeConversationId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}

      {grouped.older.length > 0 && (
        <ConversationGroup
          title="Older"
          conversations={grouped.older}
          activeConversationId={activeConversationId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}
    </div>
  )
}

interface ConversationGroupProps {
  title: string
  conversations: ConversationListItem[]
  activeConversationId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

function ConversationGroup({
  title,
  conversations,
  activeConversationId,
  onSelect,
  onRename,
  onDelete,
}: ConversationGroupProps) {
  return (
    <div className="mb-2">
      <h3 className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      <div className="space-y-1 px-2">
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeConversationId}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}
