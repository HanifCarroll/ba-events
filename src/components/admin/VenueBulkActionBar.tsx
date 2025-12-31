import { Trash2 } from 'lucide-react'
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
}

export function VenueBulkActionBar({
  selectedCount,
  isAllSelected,
  onToggleSelectAll,
  onSetBulkAction,
  onClearSelection,
  overlay = false,
}: VenueBulkActionBarProps) {
  return (
    <BulkActionBarBase
      selectedCount={selectedCount}
      isAllSelected={isAllSelected}
      onToggleSelectAll={onToggleSelectAll}
      onClearSelection={onClearSelection}
      overlay={overlay}
    >
      {overlay ? (
        <Button
          size="sm"
          onClick={() => onSetBulkAction('delete')}
          className="bg-red-600 text-white hover:bg-red-500"
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          {m.common_delete()}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSetBulkAction('delete')}
          className="border-destructive/50 text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          {m.common_delete()}
        </Button>
      )}
    </BulkActionBarBase>
  )
}
