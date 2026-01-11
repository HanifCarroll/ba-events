import type { LucideIcon } from 'lucide-react'
import { Square } from 'lucide-react'
import { Button } from '@/shared/ui/button'

export type EnrichmentColor = 'primary' | 'orange' | 'blue' | 'violet' | 'indigo'

export interface EnrichmentButtonProps {
  /** Display label (e.g., "Add Descriptions", "Luma Descriptions") */
  label: string
  /** Number of enrichable items */
  count: number
  /** Handler to start enrichment */
  onClick: () => void
  /** Whether enrichment is currently running */
  isEnriching: boolean
  /** Optional handler to stop enrichment (if stoppable) */
  onStop?: () => void
  /** Label shown during progress (e.g., "Adding Descriptions") */
  progressLabel: string
  /** Color scheme */
  color: EnrichmentColor
  /** Icon component */
  icon: LucideIcon
  /** Whether in overlay mode (affects styling) */
  overlay?: boolean
}

/**
 * Configuration object for an enrichment button (used by BulkActionBar)
 */
export interface EnrichmentConfig {
  key: string
  label: string
  progressLabel: string
  count: number
  onClick: () => void
  isEnriching: boolean
  onStop?: () => void
  color: EnrichmentColor
  icon: LucideIcon
}

function getColorStyles(color: EnrichmentColor, overlay: boolean) {
  const styles = {
    primary: overlay
      ? {
          idle: 'text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/10',
          active: 'text-yellow-200 hover:text-yellow-100 hover:bg-yellow-500/20',
        }
      : {
          idle: 'border-primary/50 text-primary hover:bg-primary/10',
          active: 'border-yellow-500/50 text-yellow-600 hover:bg-yellow-500/10',
        },
    orange: overlay
      ? {
          idle: 'text-orange-200 hover:text-orange-100 hover:bg-orange-500/20',
          active: 'text-orange-200',
        }
      : {
          idle: 'border-orange-500/50 text-orange-600 hover:bg-orange-500/10',
          active: 'border-orange-500/50 text-orange-600',
        },
    blue: overlay
      ? {
          idle: 'text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/10',
          active: 'text-primary-foreground/70',
        }
      : {
          idle: 'border-blue-500/50 text-blue-600 hover:bg-blue-500/10',
          active: 'border-blue-500/50 text-blue-600',
        },
    violet: overlay
      ? {
          idle: 'text-violet-200 hover:text-violet-100 hover:bg-violet-500/20',
          active: 'text-violet-200',
        }
      : {
          idle: 'border-violet-500/50 text-violet-600 hover:bg-violet-500/10',
          active: 'border-violet-500/50 text-violet-600',
        },
    indigo: overlay
      ? {
          idle: 'text-indigo-200 hover:text-indigo-100 hover:bg-indigo-500/20',
          active: 'text-indigo-200',
        }
      : {
          idle: 'border-indigo-500/50 text-indigo-600 hover:bg-indigo-500/10',
          active: 'border-indigo-500/50 text-indigo-600',
        },
  }
  return styles[color]
}

/**
 * Reusable enrichment button component that handles idle, in-progress,
 * and stoppable states with consistent styling.
 */
export function EnrichmentButton({
  label,
  count,
  onClick,
  isEnriching,
  onStop,
  progressLabel,
  color,
  icon: Icon,
  overlay = false,
}: EnrichmentButtonProps) {
  // Don't render if no items to enrich
  if (count === 0) return null

  const colorStyles = getColorStyles(color, overlay)

  // Idle state - show start button
  if (!isEnriching) {
    return (
      <Button
        variant={overlay ? 'ghost' : 'outline'}
        size="sm"
        onClick={onClick}
        className={colorStyles.idle}
      >
        <Icon className="h-4 w-4 mr-1.5" />
        {label} ({count})
      </Button>
    )
  }

  // Enriching state with stop capability
  if (onStop) {
    return (
      <Button
        variant={overlay ? 'ghost' : 'outline'}
        size="sm"
        onClick={onStop}
        className={colorStyles.active}
      >
        <Icon className="h-4 w-4 mr-1.5 animate-pulse" />
        Stop
      </Button>
    )
  }

  // Enriching state without stop capability (disabled progress indicator)
  return (
    <Button
      variant={overlay ? 'ghost' : 'outline'}
      size="sm"
      disabled
      className={colorStyles.active}
    >
      <Square className="h-4 w-4 mr-1.5 animate-pulse" />
      {progressLabel}...
    </Button>
  )
}
