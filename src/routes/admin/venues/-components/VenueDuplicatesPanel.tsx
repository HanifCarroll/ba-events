import { RefreshCw, CheckCircle2, GitMerge, Loader2, X, Eye } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import type { DuplicateGroup } from '@/features/venues/api/review'
import * as m from '@/paraglide/messages'

interface VenueDuplicatesPanelProps {
  groups: DuplicateGroup[]
  eventCounts: Record<string, number>
  isLoading: boolean
  onMerge: (group: DuplicateGroup) => void
  onRefresh: () => void
  onDismiss: (venueId1: string, venueId2: string) => void
  onShowDismissed: () => void
  dismissedCount: number
  isDismissing: boolean
}

export function VenueDuplicatesPanel({
  groups,
  eventCounts,
  isLoading,
  onMerge,
  onRefresh,
  onDismiss,
  onShowDismissed,
  dismissedCount,
  isDismissing,
}: VenueDuplicatesPanelProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>{m.admin_analyzing_duplicates()}</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-card/50 rounded-xl border border-border/50">
        <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
        <h3 className="font-display text-lg font-medium text-foreground mb-2">
          {m.admin_no_duplicates()}
        </h3>
        <p className="text-muted-foreground mb-4">{m.admin_no_duplicates_desc()}</p>
        <Button variant="outline" onClick={() => onRefresh()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {m.admin_re_analyze()}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <p className="text-muted-foreground">
            {m.admin_duplicates_found({ count: groups.length })}
          </p>
          {dismissedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onShowDismissed}
            >
              <Eye className="h-4 w-4 mr-1" />
              {m.admin_view_dismissed({ count: dismissedCount })}
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => onRefresh()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {m.admin_re_analyze()}
        </Button>
      </div>

      {groups.map((group) => (
        <Card key={group.primaryVenue.id} className="bg-card/50 border-border/50">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-lg text-foreground">
                  {group.primaryVenue.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {group.primaryVenue.neighborhood} &bull;{' '}
                  {m.admin_events_count({ count: eventCounts[group.primaryVenue.id] ?? 0 })}
                </p>
              </div>
              <Badge variant="outline" className="border-primary/30 text-primary">
                {m.admin_suggested()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground mb-3">
              {m.admin_duplicates()}:
            </p>
            <div className="space-y-2">
              {group.duplicates.map((dup) => (
                <div
                  key={dup.venue.id}
                  className="flex justify-between items-center p-3 bg-muted/30 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-foreground">{dup.venue.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {dup.venue.neighborhood} &bull;{' '}
                      {m.admin_events_count({ count: eventCounts[dup.venue.id] ?? 0 })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">
                      {m.admin_similarity({ percent: Math.round(dup.similarity * 100) })}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onDismiss(group.primaryVenue.id, dup.venue.id)}
                      disabled={isDismissing}
                      title={m.admin_not_duplicate()}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border/30">
              <Button size="sm" onClick={() => onMerge(group)}>
                <GitMerge className="h-4 w-4 mr-2" />
                {m.admin_merge_venues()}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
