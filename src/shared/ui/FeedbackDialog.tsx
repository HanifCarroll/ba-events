"use client"

import { useState, useEffect, useCallback } from "react"
import { CheckCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { Button } from "@/shared/ui/button"
import { Textarea } from "@/shared/ui/textarea"

const SURVEY_ID = "019bc2ff-adb1-0000-362c-eed6326569f2"
const QUESTION_ID = "c94107a7-5e8a-4ff3-aa34-f30b41268370"

// Get the initialized PostHog instance from window
function getPostHog() {
  if (typeof window === "undefined") return null
  return (window as unknown as { posthog?: { capture: (event: string, properties?: Record<string, unknown>) => void } }).posthog
}

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [feedback, setFeedback] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Track survey shown event when dialog opens
  useEffect(() => {
    if (open && !submitted) {
      getPostHog()?.capture("survey shown", {
        $survey_id: SURVEY_ID,
      })
    }
  }, [open, submitted])

  // Auto-close after submission
  useEffect(() => {
    if (submitted) {
      const timer = setTimeout(() => {
        onOpenChange(false)
        // Reset state after close animation
        setTimeout(() => {
          setSubmitted(false)
          setFeedback("")
        }, 200)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [submitted, onOpenChange])

  const handleSubmit = useCallback(() => {
    if (!feedback.trim() || isSubmitting) return

    setIsSubmitting(true)

    try {
      getPostHog()?.capture("survey sent", {
        $survey_id: SURVEY_ID,
        [`$survey_response_${QUESTION_ID}`]: feedback,
        $survey_questions: [
          {
            id: QUESTION_ID,
            question: "What feedback do you have for us?",
            response: feedback,
          },
        ],
      })
      setSubmitted(true)
    } catch (error) {
      console.error("Failed to submit feedback:", error)
    } finally {
      setIsSubmitting(false)
    }
  }, [feedback, isSubmitting])

  const handleClose = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && !submitted) {
        // Track dismissal
        getPostHog()?.capture("survey dismissed", {
          $survey_id: SURVEY_ID,
        })
      }
      onOpenChange(newOpen)

      // Reset state after close animation
      if (!newOpen) {
        setTimeout(() => {
          setSubmitted(false)
          setFeedback("")
        }, 200)
      }
    },
    [submitted, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border/50 max-w-md">
        {submitted ? (
          // Thank you state
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="font-display text-foreground mb-2">
              Thank you!
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Your feedback helps us improve BA Eventos.
            </DialogDescription>
          </div>
        ) : (
          // Feedback form
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-foreground">
                What feedback do you have for us?
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Tell us what you like, what could be better, or report any
                issues.
              </DialogDescription>
            </DialogHeader>

            <Textarea
              className="min-h-[120px] bg-background/50 border-border/50 focus-visible:border-primary/50 focus-visible:ring-primary/20"
              placeholder="Start typing..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              autoFocus
            />

            <DialogFooter>
              <Button variant="ghost" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!feedback.trim() || isSubmitting}
                className="bg-primary hover:bg-primary/90"
              >
                {isSubmitting ? "Sending..." : "Send Feedback"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
