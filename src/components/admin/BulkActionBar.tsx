import { Clock, XCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { BulkActionType } from '@/hooks/useBulkActions'

interface BulkActionBarProps {
  selectedCount: number
  filteredEventsLength: number
  onToggleSelectAll: () => void
  onSetBulkAction: (action: BulkActionType) => void
  onClearSelection: () => void
}

export function BulkActionBar({
  selectedCount,
  filteredEventsLength,
  onToggleSelectAll,
  onSetBulkAction,
  onClearSelection,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null

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
