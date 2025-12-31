import { Loader2, RotateCcw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { DismissedDuplicate } from '@/lib/admin/venue-review'
import { formatShortDate } from '@/lib/utils/formatting'
import * as m from '@/paraglide/messages'

interface DismissedDuplicatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dismissedPairs: DismissedDuplicate[]
  isLoading: boolean
  onRestore: (id: string) => void
  isRestoring: boolean
}

export function DismissedDuplicatesDialog({
  open,
  onOpenChange,
  dismissedPairs,
  isLoading,
  onRestore,
  isRestoring,
}: DismissedDuplicatesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.admin_dismissed_duplicates()}</DialogTitle>
          <DialogDescription>
            {m.admin_dismissed_duplicates_desc()}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : dismissedPairs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {m.admin_no_dismissed_duplicates()}
            </p>
          ) : (
            <div className="space-y-3">
              {dismissedPairs.map((pair) => (
                <div
                  key={pair.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {pair.venue_1_name}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {pair.venue_2_name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {m.admin_dismissed_at({ date: formatShortDate(pair.dismissed_at) })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-3 shrink-0"
                    onClick={() => onRestore(pair.id)}
                    disabled={isRestoring}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    {m.admin_restore()}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
