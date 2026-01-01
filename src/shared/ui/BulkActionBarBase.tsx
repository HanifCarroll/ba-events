import { X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import * as m from '@/paraglide/messages'

interface BulkActionBarBaseProps {
  selectedCount: number
  isAllSelected: boolean
  onToggleSelectAll: () => void
  onClearSelection: () => void
  overlay?: boolean
  children: React.ReactNode
}

/**
 * Base component for bulk action bars. Provides the common layout
 * structure (checkbox, count, spacer, actions, close button) and
 * handles overlay vs standalone rendering modes.
 *
 * Entity-specific action buttons are passed as children.
 */
export function BulkActionBarBase({
  selectedCount,
  isAllSelected,
  onToggleSelectAll,
  onClearSelection,
  overlay = false,
  children,
}: BulkActionBarBaseProps) {
  if (selectedCount === 0) return null

  if (overlay) {
    return (
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-4 px-4 py-3 bg-primary/95 backdrop-blur-sm border-b border-primary/30 rounded-t-xl animate-fade-in-up">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={isAllSelected}
            onCheckedChange={onToggleSelectAll}
            className="border-primary-foreground border-2 bg-transparent data-[state=checked]:bg-primary-foreground data-[state=checked]:border-primary-foreground data-[state=checked]:text-background"
          />
          <span className="text-sm font-medium text-primary-foreground">
            {selectedCount} selected
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {children}
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

  return (
    <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg animate-fade-in-up">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={isAllSelected}
          onCheckedChange={onToggleSelectAll}
        />
        <span className="text-sm font-medium text-foreground">
          {selectedCount} selected
        </span>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {children}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="text-muted-foreground"
        >
          {m.common_clear()}
        </Button>
      </div>
    </div>
  )
}
