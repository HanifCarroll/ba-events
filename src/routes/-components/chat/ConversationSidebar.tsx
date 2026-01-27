import { useState, useMemo, useCallback, useEffect } from 'react'
import { PlusCircle, History } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { ConversationSearch } from './ConversationSearch'
import { ConversationList } from './ConversationList'
import { useChatContext } from '@/shared/providers/ChatProvider'
import {
  useConversations,
  useSearchConversations,
  useUpdateConversation,
  useDeleteConversation,
} from '@/features/chat/hooks/useConversations'
import { cn } from '@/shared/lib/utils'

interface ConversationSidebarProps {
  className?: string
}

/**
 * Conversation history sidebar.
 * Mobile: Opens as a sheet from the left.
 * Desktop: Collapsible side panel.
 */
export function ConversationSidebar({ className }: ConversationSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const {
    activeConversationId,
    setActiveConversationId,
    isSidebarOpen,
    closeSidebar,
    startNewChat,
  } = useChatContext()

  // Debounce search query by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch conversations
  const { data: conversationsData, isLoading: isLoadingList } = useConversations()
  const { data: searchResults, isLoading: isSearching } = useSearchConversations(debouncedSearchQuery)

  // Show searching indicator when user is typing but debounce hasn't fired yet
  const isTypingSearch = searchQuery.trim() !== debouncedSearchQuery.trim()

  // Mutations
  const updateConversation = useUpdateConversation()
  const deleteConversation = useDeleteConversation()

  // Use search results if searching, otherwise use full list
  const displayConversations = useMemo(() => {
    if (debouncedSearchQuery.trim()) {
      return searchResults ?? []
    }
    return conversationsData?.conversations ?? []
  }, [debouncedSearchQuery, searchResults, conversationsData?.conversations])

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversationId(id)
      closeSidebar()
    },
    [setActiveConversationId, closeSidebar]
  )

  const handleRenameConversation = useCallback(
    (id: string, title: string) => {
      updateConversation.mutate({ id, title })
    },
    [updateConversation]
  )

  const handleDeleteConversation = useCallback(
    (id: string) => {
      deleteConversation.mutate(id)
      // If deleting the active conversation, clear it
      if (id === activeConversationId) {
        startNewChat()
      }
    },
    [deleteConversation, activeConversationId, startNewChat]
  )

  const handleNewChat = useCallback(() => {
    startNewChat()
    closeSidebar()
  }, [startNewChat, closeSidebar])

  const isLoading = isLoadingList || isSearching || isTypingSearch

  // Sidebar content (shared between mobile sheet and desktop panel)
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header with new chat button */}
      <div className="p-3 border-b">
        <Button onClick={handleNewChat} className="w-full justify-start gap-2" variant="outline">
          <PlusCircle className="h-4 w-4" />
          New conversation
        </Button>
      </div>

      {/* Search */}
      <div className="p-3">
        <ConversationSearch
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search conversations..."
        />
      </div>

      {/* Conversation list */}
      {isLoading ? (
        <div className="flex-1 px-2 py-3 space-y-2">
          {/* Skeleton group header */}
          <div className="px-3 py-2">
            <div className="h-3 w-12 bg-muted rounded animate-pulse" />
          </div>
          {/* Skeleton conversation items */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2">
              <div className="h-4 w-4 bg-muted rounded animate-pulse shrink-0" />
              <div className="h-4 flex-1 bg-muted rounded animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
            </div>
          ))}
        </div>
      ) : (
        <ConversationList
          conversations={displayConversations}
          activeConversationId={activeConversationId}
          onSelect={handleSelectConversation}
          onRename={handleRenameConversation}
          onDelete={handleDeleteConversation}
          searchQuery={debouncedSearchQuery}
        />
      )}
    </div>
  )

  return (
    <>
      {/* Mobile: Sheet overlay */}
      <Sheet open={isSidebarOpen} onOpenChange={(open) => !open && closeSidebar()}>
        <SheetContent side="left" className="w-[300px] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Conversation History</SheetTitle>
          </SheetHeader>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Desktop: Always visible panel (when open) */}
      <div
        className={cn(
          'hidden md:flex flex-col border-r bg-background transition-all duration-200',
          isSidebarOpen ? 'w-[280px]' : 'w-0 overflow-hidden',
          className
        )}
      >
        {sidebarContent}
      </div>
    </>
  )
}

/**
 * Toggle button for the sidebar.
 * Place this in the chat header.
 */
export function SidebarToggle() {
  const { toggleSidebar, isSidebarOpen } = useChatContext()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      className="shrink-0"
      aria-label={isSidebarOpen ? 'Close conversation history' : 'Open conversation history'}
    >
      <History className="h-5 w-5" />
    </Button>
  )
}
