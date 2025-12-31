import { Trash2, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BulkActionBarBase } from './BulkActionBarBase'
import * as m from '@/paraglide/messages'
import type { VenueBulkActionType } from '@/hooks/useVenueBulkActions'

interface VenueBulkActionBarProps {
  selectedCount: number
  isAllSelected: boolean
  onToggleSelectAll: () => void
  onSetBulkAction: (action: VenueBulkActionType) => void
  onClearSelection: () => void
  overlay?: boolean
  /** Number of selected venues that can be enriched (missing neighborhood) */
  enrichableCount?: number
}

export function VenueBulkActionBar({
  selectedCount,
  isAllSelected,
  onToggleSelectAll,
  onSetBulkAction,
  onClearSelection,
  overlay = false,
  enrichableCount,
}: VenueBulkActionBarProps) {
  const enrichLabel = enrichableCount !== undefined ? `Add Neighborhoods (${enrichableCount})` : 'Add Neighborhoods'

  return (
    <BulkActionBarBase
      selectedCount={selectedCount}
      isAllSelected={isAllSelected}
      onToggleSelectAll={onToggleSelectAll}
      onClearSelection={onClearSelection}
      overlay={overlay}
    >
      {overlay ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSetBulkAction('enrich')}
            className="text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/10"
          >
            <MapPin className="h-4 w-4 mr-1.5" />
            {enrichLabel}
          </Button>
          <Button
            size="sm"
            onClick={() => onSetBulkAction('delete')}
            className="bg-red-600 text-white hover:bg-red-500"
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            {m.common_delete()}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSetBulkAction('enrich')}
            className="border-blue-500/50 text-blue-600 hover:bg-blue-500/10"
          >
            <MapPin className="h-4 w-4 mr-1.5" />
            {enrichLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSetBulkAction('delete')}
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            {m.common_delete()}
          </Button>
        </>
      )}
    </BulkActionBarBase>
  )
}
