/**
 * Personalization Prompt Modal
 *
 * Shown to users after signup to encourage them to set up their preferences
 * for better event recommendations.
 */

import { Link } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import * as m from '@/paraglide/messages'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'

interface PersonalizationPromptProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STORAGE_KEY = 'personalization-prompt-dismissed'

export function PersonalizationPrompt({
  open,
  onOpenChange,
}: PersonalizationPromptProps) {
  const handleDismiss = () => {
    // Remember that the user dismissed the prompt
    localStorage.setItem(STORAGE_KEY, 'true')
    onOpenChange(false)
  }

  const handleSetUp = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            {m.personalization_prompt_title()}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground pt-2">
            {m.personalization_prompt_desc()}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 mt-4">
          <Link to="/profile" onClick={handleSetUp}>
            <Button className="w-full">{m.personalization_prompt_setup()}</Button>
          </Link>
          <Button variant="ghost" onClick={handleDismiss}>
            {m.personalization_prompt_later()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Check if the personalization prompt has been dismissed
 */
export function wasPromptDismissed(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

/**
 * Reset the prompt dismissed state (for testing)
 */
export function resetPromptDismissed(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
