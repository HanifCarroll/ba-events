import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquare, MoreHorizontal, Pencil, Trash2, Check, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { cn } from '@/shared/lib/utils'
import type { ConversationListItem } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'
import { isGenericConversationTitle } from '@/features/chat/lib/title'

interface ChatsPageListProps {
  conversations: ConversationListItem[]
  activeConversationId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  searchQuery?: string
}

/**
 * Flat list of conversations for the /chats page.
 * Shows each conversation with "Last message X ago" timestamp.
 * Claude.ai style - no time groupings.
 */
export function ChatsPageList({
  conversations,
  activeConversationId,
  onSelect,
  onRename,
  onDelete,
  searchQuery,
}: ChatsPageListProps) {
  if (conversations.length === 0) {
    const isSearching = searchQuery && searchQuery.trim().length > 0
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
        {isSearching ? (
          <>
            <p className="text-lg font-medium text-foreground">No results for "{searchQuery}"</p>
            <p className="text-sm text-muted-foreground mt-1">Try different keywords</p>
          </>
        ) : (
          <>
            <p className="text-lg font-medium text-foreground">{m.chats_empty_title()}</p>
            <p className="text-sm text-muted-foreground mt-1">{m.chats_empty_desc()}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/50">
      {conversations.map((conv) => (
        <ChatsPageItem
          key={conv.id}
          conversation={conv}
          isActive={conv.id === activeConversationId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}

interface ChatsPageItemProps {
  conversation: ConversationListItem
  isActive: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

const TITLE_NAMING_WINDOW_MS = 2 * 60 * 1000

export function isLikelyNamingPending(conversation: ConversationListItem, nowMs = Date.now()): boolean {
  if (!isGenericConversationTitle(conversation.title)) return false
  if (!conversation.preview?.trim()) return false
  const updatedAtMs = new Date(conversation.updated_at).getTime()
  if (Number.isNaN(updatedAtMs)) return false
  return nowMs - updatedAtMs < TITLE_NAMING_WINDOW_MS
}

function ChatsPageItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ChatsPageItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(conversation.title)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const timeAgo = formatDistanceToNow(new Date(conversation.updated_at), { addSuffix: true })
  const hasPreview = !!conversation.preview?.trim()
  const primaryLine = hasPreview ? conversation.preview!.trim() : conversation.title
  const showNamingState = isLikelyNamingPending(conversation)
  const showTitleMetadata = hasPreview && !showNamingState
  const isGenericTitle = isGenericConversationTitle(conversation.title)

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditTitle(conversation.title)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (editTitle.trim() && editTitle !== conversation.title) {
      onRename(conversation.id, editTitle.trim())
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditTitle(conversation.title)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = () => {
    onDelete(conversation.id)
    setShowDeleteDialog(false)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !isEditing && onSelect(conversation.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isEditing) onSelect(conversation.id)
      }}
      className={cn(
        'group flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors',
        'hover:bg-muted/50',
        isActive && 'bg-primary/5 border-l-2 border-primary'
      )}
    >
      <MessageSquare className="h-5 w-5 shrink-0 text-muted-foreground" />

      {isEditing ? (
        <div className="flex-1 flex items-center gap-2">
          <Input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            className="h-8"
            onClick={(e) => e.stopPropagation()}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              handleSaveEdit()
            }}
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              handleCancelEdit()
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{primaryLine}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {showNamingState ? (
                m.chats_naming()
              ) : (
                <>
                  {showTitleMetadata && (
                    <span className={cn('mr-2', isGenericTitle && 'text-muted-foreground/60')}>
                      {conversation.title}
                    </span>
                  )}
                  {m.chats_last_message({ time: timeAgo })}
                </>
              )}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Conversation options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem onClick={handleStartEdit}>
                <Pencil className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDeleteClick}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{conversation.title}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
