import { useState } from 'react'
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
import { isGenericConversationTitle } from '@/features/chat/lib/title'

interface ConversationItemProps {
  conversation: ConversationListItem
  isActive: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

/**
 * Single conversation row in the sidebar.
 * Shows title, supports rename/delete actions via dropdown menu.
 */
export function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(conversation.title)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const hasPreview = !!conversation.preview?.trim()
  const primaryLine = hasPreview ? conversation.preview!.trim() : conversation.title
  const showSecondaryLine = hasPreview
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
        'group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors',
        'hover:bg-accent/50',
        isActive && 'bg-accent'
      )}
    >
      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />

      {isEditing ? (
        <div className="flex-1 flex items-center gap-1">
          <Input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            className="h-7 text-sm"
            onClick={(e) => e.stopPropagation()}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              handleSaveEdit()
            }}
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              handleCancelEdit()
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{primaryLine}</p>
            {showSecondaryLine && (
              <p className={cn('text-xs truncate text-muted-foreground', isGenericTitle && 'text-muted-foreground/60')}>
                {conversation.title}
              </p>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
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
