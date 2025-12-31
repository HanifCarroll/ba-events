import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Venue } from '@/lib/types'
import * as m from '@/paraglide/messages'

interface RenameVenueDialogProps {
  venue: Venue | null
  suggestedName?: string
  onConfirm: (name: string) => void
  onCancel: () => void
  isLoading: boolean
}

export function RenameVenueDialog({
  venue,
  suggestedName,
  onConfirm,
  onCancel,
  isLoading,
}: RenameVenueDialogProps) {
  const [name, setName] = useState('')

  // Reset form when venue changes
  useEffect(() => {
    if (venue) {
      setName(suggestedName || venue.name)
    }
  }, [venue, suggestedName])

  if (!venue) return null

  const canSubmit = name.trim() && name.trim() !== venue.name

  return (
    <Dialog open={!!venue} onOpenChange={() => onCancel()}>
      <DialogContent className="bg-card border-border/50">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">
            {m.admin_rename_venue()}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {m.admin_rename_venue_desc()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label className="text-muted-foreground">{m.admin_current_name()}</Label>
            <p className="font-medium text-foreground mt-1">{venue.name}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">{m.admin_new_name()}</Label>
            <Input
              id="new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.admin_enter_venue_name()}
              className="bg-background/50 border-border/50"
            />
            {suggestedName && suggestedName !== name && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-primary"
                onClick={() => setName(suggestedName)}
              >
                {m.admin_use_suggested({ name: suggestedName })}
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onCancel} className="text-muted-foreground">
            {m.common_cancel()}
          </Button>
          <Button onClick={() => onConfirm(name.trim())} disabled={!canSubmit || isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {m.common_saving()}
              </>
            ) : (
              m.common_save()
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
