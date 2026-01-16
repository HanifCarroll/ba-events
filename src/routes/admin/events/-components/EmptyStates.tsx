import type { ReactNode } from 'react'
import { Calendar, Plus, CheckCircle2 } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { EmptyState as SharedEmptyState, NoMatchesState as SharedNoMatchesState } from '@/shared/ui/EmptyState'

type EventTab = 'all' | 'needs_attention' | 'pending_review' | 'past'

export function EmptyState(): ReactNode {
  return (
    <SharedEmptyState
      icon={<Calendar className="h-12 w-12 text-muted-foreground" />}
      title={m.admin_no_events()}
      description={m.admin_no_events_desc()}
      action={{
        label: m.admin_add_event(),
        href: '/admin/events/new',
        icon: <Plus className="h-4 w-4" />,
      }}
    />
  )
}

interface NoMatchesStateProps {
  onClearFilters: () => void
}

export function NoMatchesState({ onClearFilters }: NoMatchesStateProps): ReactNode {
  return (
    <SharedNoMatchesState
      title={m.admin_no_matching_events()}
      description={m.admin_no_matching_desc()}
      onClearFilters={onClearFilters}
      clearLabel={m.common_clear_filters()}
    />
  )
}

interface TabEmptyStateProps {
  tab: EventTab
}

export function TabEmptyState({ tab }: TabEmptyStateProps): ReactNode {
  const config: Record<EventTab, { icon: ReactNode; title: string; description: string }> = {
    all: {
      icon: <Calendar className="h-12 w-12 text-muted-foreground" />,
      title: m.admin_no_events(),
      description: m.admin_no_events_desc(),
    },
    needs_attention: {
      icon: <CheckCircle2 className="h-12 w-12 text-green-500" />,
      title: 'All events are complete!',
      description: 'No events need attention right now.',
    },
    pending_review: {
      icon: <CheckCircle2 className="h-12 w-12 text-green-500" />,
      title: 'No events pending review',
      description: 'All imported events have been reviewed.',
    },
    past: {
      icon: <Calendar className="h-12 w-12 text-muted-foreground" />,
      title: 'No past events',
      description: 'Past events will appear here after they end.',
    },
  }

  const { icon, title, description } = config[tab]

  return <SharedEmptyState icon={icon} title={title} description={description} />
}
