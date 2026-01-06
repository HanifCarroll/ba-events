import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Badge } from '@/shared/ui/badge'
import type { DuplicateInfo, FieldDiff } from '@/features/import'

interface DiffViewerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  duplicateInfo: DuplicateInfo | null
}

function formatFieldName(field: string): string {
  const fieldLabels: Record<string, string> = {
    name: 'Name',
    starts_at: 'Start Time',
    ends_at: 'End Time',
    venue_id: 'Venue',
    price: 'Price',
    image_url: 'Image URL',
    link: 'Link',
  }
  return fieldLabels[field] || field
}

function formatValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '(empty)'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toString()

  // Handle date strings
  if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T/)) {
    try {
      const date = new Date(value)
      return date.toLocaleString('es-AR', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return value
    }
  }

  // Truncate long strings
  if (value.length > 100) {
    return value.substring(0, 100) + '...'
  }

  return value
}

function DiffRow({ diff }: { diff: FieldDiff }) {
  return (
    <div
      className={`grid grid-cols-[120px_1fr_1fr] gap-4 py-3 px-4 rounded-lg ${
        diff.hasChanged ? 'bg-amber-500/5 border border-amber-500/20' : 'bg-muted/30'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="font-medium text-sm">{formatFieldName(diff.field)}</span>
        {diff.hasChanged && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/30 text-amber-500">
            Changed
          </Badge>
        )}
      </div>
      <div className="text-sm">
        <div className="text-muted-foreground text-xs mb-1">Existing</div>
        <div className={diff.hasChanged ? 'text-red-400 line-through' : 'text-foreground'}>
          {formatValue(diff.existingValue)}
        </div>
      </div>
      <div className="text-sm">
        <div className="text-muted-foreground text-xs mb-1">New</div>
        <div className={diff.hasChanged ? 'text-green-400' : 'text-foreground'}>
          {formatValue(diff.newValue)}
        </div>
      </div>
    </div>
  )
}

export function DiffViewerDialog({ open, onOpenChange, duplicateInfo }: DiffViewerDialogProps) {
  if (!duplicateInfo) return null

  const changedFields = duplicateInfo.diffs.filter((d) => d.hasChanged)
  const unchangedFields = duplicateInfo.diffs.filter((d) => !d.hasChanged)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Event Comparison</DialogTitle>
          <DialogDescription>
            Comparing existing event with new data from source.
            {changedFields.length > 0 && (
              <span className="ml-1 text-amber-500">
                {changedFields.length} field{changedFields.length !== 1 ? 's' : ''} changed.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-4">
          {/* Changed fields first */}
          {changedFields.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-amber-500 flex items-center gap-2">
                Changed Fields
              </h4>
              {changedFields.map((diff) => (
                <DiffRow key={diff.field} diff={diff} />
              ))}
            </div>
          )}

          {/* Unchanged fields */}
          {unchangedFields.length > 0 && (
            <div className="space-y-2 mt-4">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                Unchanged Fields
              </h4>
              {unchangedFields.map((diff) => (
                <DiffRow key={diff.field} diff={diff} />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
          <p>
            <strong>Note:</strong> If you import this event, it will update the existing record
            with the new values shown above.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
