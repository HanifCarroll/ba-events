import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'

interface EmptyStateProps {
  /** The icon to display (should be a Lucide icon component) */
  icon: ReactNode
  /** Main title text */
  title: string
  /** Description text */
  description?: string
  /** Primary action button configuration */
  action?: {
    label: string
    href?: string
    onClick?: () => void
    icon?: ReactNode
  }
  /** Additional CSS classes */
  className?: string
  /** Size variant */
  variant?: 'default' | 'compact'
}

/**
 * Standardized empty state component for consistent UI across the application.
 * Use this when a list, table, or section has no content to display.
 *
 * @example
 * <EmptyState
 *   icon={<Calendar className="h-12 w-12 text-muted-foreground" />}
 *   title="No events yet"
 *   description="Get started by adding your first event."
 *   action={{ label: "Add Event", href: "/admin/events/new", icon: <Plus className="h-4 w-4" /> }}
 * />
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant = 'default',
}: EmptyStateProps) {
  const isCompact = variant === 'compact'

  return (
    <div
      className={cn(
        'text-center bg-card/50 rounded-xl border border-border/50',
        isCompact ? 'py-8' : 'py-12',
        className
      )}
    >
      <div className={cn('mx-auto', isCompact ? 'mb-3' : 'mb-4')}>
        {icon}
      </div>
      <h3
        className={cn(
          'font-display font-medium text-foreground',
          isCompact ? 'text-base mb-1' : 'text-lg mb-2'
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'text-muted-foreground',
            isCompact ? 'text-sm mb-3' : 'mb-4'
          )}
        >
          {description}
        </p>
      )}
      {action && (
        action.href ? (
          <Button asChild className="bg-primary text-primary-foreground">
            <Link to={action.href}>
              {action.icon && <span className="mr-2">{action.icon}</span>}
              {action.label}
            </Link>
          </Button>
        ) : action.onClick ? (
          <Button
            onClick={action.onClick}
            className="bg-primary text-primary-foreground"
          >
            {action.icon && <span className="mr-2">{action.icon}</span>}
            {action.label}
          </Button>
        ) : null
      )}
    </div>
  )
}

interface LoadingStateProps {
  /** Loading message */
  message?: string
  /** Additional CSS classes */
  className?: string
  /** Size variant */
  variant?: 'default' | 'compact' | 'inline'
}

/**
 * Standardized loading state component for consistent UI across the application.
 *
 * @example
 * <LoadingState message="Loading events..." />
 */
export function LoadingState({
  message,
  className,
  variant = 'default',
}: LoadingStateProps) {
  if (variant === 'inline') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    )
  }

  const isCompact = variant === 'compact'

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center',
        isCompact ? 'py-8' : 'py-16',
        className
      )}
    >
      <div
        className={cn(
          'border-2 border-primary border-t-transparent rounded-full animate-spin',
          isCompact ? 'w-6 h-6 mb-2' : 'w-8 h-8 mb-4'
        )}
      />
      {message && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}
    </div>
  )
}

interface NoMatchesStateProps {
  /** Main title text */
  title?: string
  /** Description text */
  description?: string
  /** Callback to clear filters */
  onClearFilters: () => void
  /** Clear filters button label */
  clearLabel?: string
  /** Additional CSS classes */
  className?: string
}

/**
 * Standardized "no matches" state for when filters hide all content.
 *
 * @example
 * <NoMatchesState
 *   onClearFilters={() => setFilters({})}
 *   title="No matching events"
 *   description="Try adjusting your filters."
 * />
 */
export function NoMatchesState({
  title = 'No results found',
  description = 'Try adjusting your filters.',
  onClearFilters,
  clearLabel = 'Clear filters',
  className,
}: NoMatchesStateProps) {
  return (
    <div
      className={cn(
        'text-center py-12 bg-card/50 rounded-xl border border-border/50',
        className
      )}
    >
      <div className="mx-auto mb-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 text-muted-foreground mx-auto"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
      </div>
      <h3 className="font-display text-lg font-medium text-foreground mb-2">
        {title}
      </h3>
      <p className="text-muted-foreground mb-4">{description}</p>
      <Button variant="outline" onClick={onClearFilters}>
        {clearLabel}
      </Button>
    </div>
  )
}
