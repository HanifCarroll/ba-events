import { useState, useMemo, useCallback, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { MessageSquare, Plus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { ConversationSearch } from '@/routes/-components/chat/ConversationSearch'
import { ChatsPageList } from '@/routes/-components/chat/ChatsPageList'
import { useChatContext } from '@/shared/providers/ChatProvider'
import {
  useConversations,
  useSearchConversations,
  useUpdateConversation,
  useDeleteConversation,
} from '@/features/chat/hooks/useConversations'
import * as m from '@/paraglide/messages'

export const Route = createFileRoute('/chats')({
  component: ChatsPage,
})

function ChatsPage() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const { activeConversationId, setActiveConversationId, startNewChat } = useChatContext()

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

  const totalCount = conversationsData?.conversations?.length ?? 0

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversationId(id)
      navigate({ to: '/' })
    },
    [setActiveConversationId, navigate]
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
    navigate({ to: '/' })
  }, [startNewChat, navigate])

  const isLoading = isLoadingList || isSearching || isTypingSearch

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <h1 className="font-display text-xl font-semibold tracking-tight">
              {m.chats_title()}
            </h1>
          </div>
          <Button onClick={handleNewChat} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {m.chats_new_chat()}
          </Button>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b border-border/30">
          <ConversationSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={m.chats_search_placeholder()}
          />
        </div>

        {/* Stats */}
        {!isLoading && totalCount > 0 && (
          <div className="px-6 py-3 text-sm text-muted-foreground border-b border-border/30">
            {m.chats_count({ count: totalCount })}
          </div>
        )}

        {/* List - scrollable */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="px-6 py-4 space-y-3">
              {/* Skeleton items */}
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-4">
                  <div className="h-5 w-5 bg-muted rounded animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div
                      className="h-4 bg-muted rounded animate-pulse"
                      style={{ width: `${50 + Math.random() * 40}%` }}
                    />
                    <div className="h-3 w-32 bg-muted/60 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ChatsPageList
              conversations={displayConversations}
              activeConversationId={activeConversationId}
              onSelect={handleSelectConversation}
              onRename={handleRenameConversation}
              onDelete={handleDeleteConversation}
              searchQuery={debouncedSearchQuery}
            />
          )}
        </div>
      </div>
    </div>
  )
}
