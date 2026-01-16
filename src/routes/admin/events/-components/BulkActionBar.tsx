import { Clock, XCircle, Trash2, X, MapPinOff } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import type { BulkActionType } from '@/features/events/hooks/useBulkActions'
import { EnrichmentButton, type EnrichmentConfig } from './EnrichmentButton'

interface BulkActionBarProps {
  selectedCount: number
  filteredEventsLength: number
  onToggleSelectAll: () => void
  onSetBulkAction: (action: BulkActionType) => void
  onClearSelection: () => void
  /** If true, renders as an overlay-ready component (no outer margins, fills width) */
  overlay?: boolean
  /** Array of enrichment button configurations */
  enrichments?: EnrichmentConfig[]
}

export function BulkActionBar({
  selectedCount,
  filteredEventsLength,
  onToggleSelectAll,
  onSetBulkAction,
  onClearSelection,
  overlay = false,
  enrichments = [],
}: BulkActionBarProps) {
  if (selectedCount === 0) return null

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
          {enrichments.map(({ key, ...config }) => (
            <EnrichmentButton key={key} {...config} overlay />
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSetBulkAction('location_tba')}
            className="text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/10"
          >
            <MapPinOff className="h-4 w-4 mr-1.5" />
            Venue TBA
          </Button>
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
            onClick={() => onSetBulkAction('canceled')}
            className="text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/10"
          >
            <XCircle className="h-4 w-4 mr-1.5" />
            Mark Cancelled
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onSetBulkAction('delete')}
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
        {enrichments.map(({ key, ...config }) => (
          <EnrichmentButton key={key} {...config} overlay={false} />
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSetBulkAction('location_tba')}
          className="border-border/50"
        >
          <MapPinOff className="h-4 w-4 mr-1.5" />
          Venue TBA
        </Button>
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
          onClick={() => onSetBulkAction('canceled')}
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
