import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import * as m from '@/paraglide/messages'

interface ConfirmationDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the dialog should close */
  onOpenChange: (open: boolean) => void
  /** Dialog title */
  title: string
  /** Dialog description/message */
  description: string
  /** Text for the cancel button (defaults to common_cancel translation) */
  cancelText?: string
  /** Text for the confirm button (defaults to common_confirm translation) */
  confirmText?: string
  /** Text shown while confirming (when isConfirming is true) */
  confirmingText?: string
  /** Called when the confirm button is clicked */
  onConfirm: () => void
  /** Whether the confirm action is in progress */
  isConfirming?: boolean
  /** Whether the confirm button should be disabled (independent of isConfirming) */
  confirmDisabled?: boolean
  /** Variant for the confirm button */
  variant?: 'default' | 'destructive'
}

/**
 * A standardized confirmation dialog component.
 *
 * @example
 * ```tsx
 * <ConfirmationDialog
 *   open={showDeleteDialog}
 *   onOpenChange={setShowDeleteDialog}
 *   title="Delete Event"
 *   description="Are you sure you want to delete this event?"
 *   variant="destructive"
 *   confirmText="Delete"
 *   confirmingText="Deleting..."
 *   onConfirm={handleDelete}
 *   isConfirming={isDeleting}
 * />
 * ```
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelText,
  confirmText,
  confirmingText,
  onConfirm,
  isConfirming = false,
  confirmDisabled = false,
  variant = 'default',
}: ConfirmationDialogProps) {
  const cancel = cancelText ?? m.common_cancel()
  const confirm = confirmText ?? m.common_confirm()
  const confirming = confirmingText ?? m.common_processing()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground"
          >
            {cancel}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={isConfirming || confirmDisabled}
          >
            {isConfirming ? confirming : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
