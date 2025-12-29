import { Clock, XCircle, Trash2, X, Sparkles, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { BulkActionType } from '@/hooks/useBulkActions'

interface BulkActionBarProps {
  selectedCount: number
  filteredEventsLength: number
  onToggleSelectAll: () => void
  onSetBulkAction: (action: BulkActionType) => void
  onClearSelection: () => void
  /** If true, renders as an overlay-ready component (no outer margins, fills width) */
  overlay?: boolean
  /** Number of selected events that can be enriched (missing description with link) */
  enrichableCount?: number
  /** Callback to enrich selected events */
  onEnrich?: () => void
  /** Whether enrichment is currently running */
  isEnriching?: boolean
  /** Callback to stop enrichment */
  onStopEnrich?: () => void
}

export function BulkActionBar({
  selectedCount,
  filteredEventsLength,
  onToggleSelectAll,
  onSetBulkAction,
  onClearSelection,
  overlay = false,
  enrichableCount = 0,
  onEnrich,
  isEnriching = false,
  onStopEnrich,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null

  const showEnrich = enrichableCount > 0 && onEnrich

  if (overlay) {
    // Overlay version - slides in over table header
    return (
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-4 px-4 py-3 bg-primary/95 backdrop-blur-sm border-b border-primary/30 rounded-t-xl animate-fade-in-up">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={selectedCount === filteredEventsLength}
            onCheckedChange={onToggleSelectAll}
            className="border-primary-foreground border-2 bg-transparent data-[state=checked]:bg-primary-foreground data-[state=checked]:border-primary-foreground data-[state=checked]:text-background"
          />
          <span className="text-sm font-medium text-primary-foreground">
            {selectedCount} selected
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {showEnrich && !isEnriching && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEnrich}
              className="text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/10"
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              Enrich ({enrichableCount})
            </Button>
          )}
          {isEnriching && onStopEnrich && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onStopEnrich}
              className="text-yellow-200 hover:text-yellow-100 hover:bg-yellow-500/20"
            >
              <Square className="h-4 w-4 mr-1.5" />
              Stop
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSetBulkAction('past')}
            className="text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/10"
          >
            <Clock className="h-4 w-4 mr-1.5" />
            Mark Past
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSetBulkAction('cancelled')}
            className="text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/10"
          >
            <XCircle className="h-4 w-4 mr-1.5" />
            Mark Cancelled
          </Button>
          <Button
            size="sm"
            onClick={() => onSetBulkAction('delete')}
            className="bg-red-600 text-white hover:bg-red-500"
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClearSelection}
            className="h-8 w-8 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  // Default standalone version
  return (
    <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg animate-fade-in-up">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={selectedCount === filteredEventsLength}
          onCheckedChange={onToggleSelectAll}
        />
        <span className="text-sm font-medium text-foreground">
          {selectedCount} selected
        </span>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {showEnrich && !isEnriching && (
          <Button
            variant="outline"
            size="sm"
            onClick={onEnrich}
            className="border-primary/50 text-primary hover:bg-primary/10"
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            Enrich ({enrichableCount})
          </Button>
        )}
        {isEnriching && onStopEnrich && (
          <Button
            variant="outline"
            size="sm"
            onClick={onStopEnrich}
            className="border-yellow-500/50 text-yellow-600 hover:bg-yellow-500/10"
          >
            <Square className="h-4 w-4 mr-1.5" />
            Stop
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSetBulkAction('past')}
          className="border-border/50"
        >
          <Clock className="h-4 w-4 mr-1.5" />
          Mark Past
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSetBulkAction('cancelled')}
          className="border-border/50"
        >
          <XCircle className="h-4 w-4 mr-1.5" />
          Mark Cancelled
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSetBulkAction('delete')}
          className="border-destructive/50 text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          Delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="text-muted-foreground"
        >
          Clear
        </Button>
      </div>
    </div>
  )
}
