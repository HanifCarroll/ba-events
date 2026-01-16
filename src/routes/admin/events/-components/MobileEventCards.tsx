import type { ReactNode } from 'react'
import { memo, useRef, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Calendar, MapPin, Pencil, Trash2, CheckCircle2, XCircle } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/checkbox'
import { SwipeableCard } from '@/shared/ui/SwipeableCard'
import { formatDateTime } from '@/shared/lib/utils/formatting'
import type { EventListItem } from '@/features/events'
import { getStatusBadge } from './filters.tsx'

interface MobileEventCardProps {
  event: EventListItem
  isSelected: boolean
  onToggleSelect: (id: string) => void
  onEdit: (event: EventListItem) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onDelete: (event: EventListItem) => void
  isApproving: string | null
  isRejecting: string | null
  showNeedsAttention?: boolean
  selectionMode: boolean
  onEnterSelectionMode: () => void
}

export const MobileEventCard = memo(function MobileEventCard({
  event,
  isSelected,
  onToggleSelect,
  onEdit,
  onApprove,
  onReject,
  onDelete,
  isApproving: _isApproving,
  isRejecting: _isRejecting,
  showNeedsAttention,
  selectionMode,
  onEnterSelectionMode,
}: MobileEventCardProps): ReactNode {
  const needsDescription = !event.has_description_es && event.link

  // Swipe actions based on event status
  const leftActions =
    event.status === 'pending_review'
      ? [
          {
            icon: <CheckCircle2 className="h-5 w-5" />,
            label: m.admin_approve(),
            onClick: () => onApprove(event.id),
            variant: 'primary' as const,
          },
        ]
      : [
          {
            icon: <Pencil className="h-5 w-5" />,
            label: m.common_edit(),
            onClick: () => onEdit(event),
            variant: 'primary' as const,
          },
        ]

  const rightActions =
    event.status === 'pending_review'
      ? [
          {
            icon: <XCircle className="h-5 w-5" />,
            label: m.admin_reject(),
            onClick: () => onReject(event.id),
            variant: 'destructive' as const,
          },
        ]
      : [
          {
            icon: <Trash2 className="h-5 w-5" />,
            label: m.common_delete(),
            onClick: () => onDelete(event),
            variant: 'destructive' as const,
          },
        ]

  const handleLongPress = useCallback(() => {
    onEnterSelectionMode()
    onToggleSelect(event.id)
  }, [onEnterSelectionMode, onToggleSelect, event.id])

  const handleCardClick = useCallback(() => {
    if (selectionMode) {
      onToggleSelect(event.id)
    }
  }, [selectionMode, onToggleSelect, event.id])

  const cardContent = (
    <div
      className={`bg-card/50 rounded-xl border border-border/50 p-4 space-y-2 transition-colors ${
        isSelected ? 'border-primary/50 bg-primary/5' : ''
      }`}
      onClick={handleCardClick}
    >
      {/* Header with title and status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Checkbox only in selection mode */}
          {selectionMode && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(event.id)}
              className="mt-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <div className="flex-1 min-w-0">
            {/* Allow 2 lines for title */}
            <p className="font-medium text-foreground line-clamp-2 leading-tight">{event.name}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {showNeedsAttention && needsDescription && (
                <Badge
                  variant="outline"
                  className="text-xs bg-orange-500/10 text-orange-400 border-orange-500/30"
                >
                  {m.admin_no_description()}
                </Badge>
              )}
              {event.categories.slice(0, 2).map((cat) => (
                <Badge
                  key={cat}
                  variant="outline"
                  className="text-xs border-border/50 text-muted-foreground"
                >
                  {cat}
                </Badge>
              ))}
              {event.categories.length > 2 && (
                <span className="text-xs text-muted-foreground">+{event.categories.length - 2}</span>
              )}
            </div>
          </div>
        </div>
        {getStatusBadge(event.status)}
      </div>

      {/* Event details */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span>{formatDateTime(event.starts_at)}</span>
        </div>
        {event.venue_name && (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{event.venue_name}</span>
          </div>
        )}
      </div>
    </div>
  )

  // In selection mode, don't wrap with swipeable (prevents accidental actions)
  if (selectionMode) {
    return cardContent
  }

  return (
    <SwipeableCard
      leftActions={leftActions}
      rightActions={rightActions}
      onLongPress={handleLongPress}
      className="rounded-xl"
    >
      {cardContent}
    </SwipeableCard>
  )
})

interface MobileEventCardsProps {
  events: EventListItem[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onEdit: (event: EventListItem) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onDelete: (event: EventListItem) => void
  isApproving: string | null
  isRejecting: string | null
  showNeedsAttention?: boolean
  selectionMode?: boolean
  onEnterSelectionMode?: () => void
}

export function MobileEventCards({
  events,
  selectedIds,
  onToggleSelect,
  onEdit,
  onApprove,
  onReject,
  onDelete,
  isApproving,
  isRejecting,
  showNeedsAttention,
  selectionMode = false,
  onEnterSelectionMode = () => {},
}: MobileEventCardsProps): ReactNode {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // Reduced from 180 since we removed action buttons
    overscan: 5,
  })

  return (
    <div ref={parentRef} className="sm:hidden h-[calc(100vh-340px)] overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const event = events[virtualRow.index]
          return (
            <div
              key={event.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                padding: '6px 0',
              }}
            >
              <MobileEventCard
                event={event}
                isSelected={selectedIds.has(event.id)}
                onToggleSelect={onToggleSelect}
                onEdit={onEdit}
                onApprove={onApprove}
                onReject={onReject}
                onDelete={onDelete}
                isApproving={isApproving}
                isRejecting={isRejecting}
                showNeedsAttention={showNeedsAttention}
                selectionMode={selectionMode}
                onEnterSelectionMode={onEnterSelectionMode}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
