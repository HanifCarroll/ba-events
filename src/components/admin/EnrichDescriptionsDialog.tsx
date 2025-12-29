import { useRef, memo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileText, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { EventWithVenue } from '@/lib/types'
import type { DescriptionFetchResult } from '@/lib/scrapers/passline'
import type { EnrichStep } from '@/hooks/useDescriptionEnrichment'

// Memoized list item for virtualized list
const EnrichEventItem = memo(function EnrichEventItem({
  event,
  isSelected,
  onToggle,
}: {
  event: EventWithVenue
  isSelected: boolean
  onToggle: (id: string) => void
}) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
        isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
      }`}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggle(event.id)}
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground truncate text-sm">{event.name}</p>
        {event.venue_name && (
          <p className="text-xs text-muted-foreground truncate">{event.venue_name}</p>
        )}
      </div>
      {!event.link && (
        <Badge variant="outline" className="text-xs border-yellow-500/30 text-yellow-500">
          No link
        </Badge>
      )}
    </div>
  )
})

// Virtualized list for event selection
function EnrichEventsList({
  events,
  selectedIds,
  onToggle,
  onToggleAll,
}: {
  events: EventWithVenue[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  })

  return (
    <div className="flex-1 min-h-0 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedIds.size === events.length}
            onCheckedChange={onToggleAll}
          />
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} of {events.length} selected
          </span>
        </div>
      </div>
      <div
        ref={parentRef}
        className="h-[300px] overflow-auto rounded-md border border-border/50"
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const event = events[virtualItem.index]
            return (
              <div
                key={event.id}
                className="absolute top-0 left-0 w-full px-2"
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <EnrichEventItem
                  event={event}
                  isSelected={selectedIds.has(event.id)}
                  onToggle={onToggle}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface EnrichDescriptionsDialogProps {
  open: boolean
  onClose: () => void
  enrichStep: EnrichStep
  setEnrichStep: (step: EnrichStep) => void
  enrichProgress: { current: number; total: number } | null
  fetchedDescriptions: DescriptionFetchResult[]
  isLoadingEvents: boolean
  eventsWithoutDesc: EventWithVenue[]
  enrichSelectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onFetchDescriptions: () => void
  onSaveDescriptions: () => void
}

export function EnrichDescriptionsDialog({
  open,
  onClose,
  enrichStep,
  setEnrichStep,
  enrichProgress,
  fetchedDescriptions,
  isLoadingEvents,
  eventsWithoutDesc,
  enrichSelectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onFetchDescriptions,
  onSaveDescriptions,
}: EnrichDescriptionsDialogProps) {
  const foundCount = fetchedDescriptions.filter(r => r.description).length
  const notFoundCount = fetchedDescriptions.filter(r => !r.description).length

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="bg-card border-border/50 max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Enrich Descriptions
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {enrichStep === 'select' && 'Fetch real descriptions from Passline event pages.'}
            {enrichStep === 'fetching' && 'Fetching descriptions from event pages...'}
            {enrichStep === 'preview' && 'Review fetched descriptions before saving.'}
            {enrichStep === 'saving' && 'Saving descriptions and updating embeddings...'}
          </DialogDescription>
        </DialogHeader>

        {/* Loading state */}
        {isLoadingEvents && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* No events state */}
        {!isLoadingEvents && enrichStep === 'select' && eventsWithoutDesc.length === 0 && (
          <div className="text-center py-12">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-foreground font-medium">All events have descriptions!</p>
            <p className="text-muted-foreground text-sm mt-1">Nothing to enrich.</p>
          </div>
        )}

        {/* Select events step */}
        {!isLoadingEvents && enrichStep === 'select' && eventsWithoutDesc.length > 0 && (
          <EnrichEventsList
            events={eventsWithoutDesc}
            selectedIds={enrichSelectedIds}
            onToggle={onToggleSelect}
            onToggleAll={onToggleSelectAll}
          />
        )}

        {/* Fetching step */}
        {enrichStep === 'fetching' && enrichProgress && (
          <div className="py-8 space-y-4">
            <Progress value={(enrichProgress.current / enrichProgress.total) * 100} />
            <p className="text-center text-sm text-muted-foreground">
              Fetching {enrichProgress.current} of {enrichProgress.total} descriptions...
            </p>
          </div>
        )}

        {/* Preview step */}
        {enrichStep === 'preview' && (
          <div className="flex-1 min-h-0 space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-green-500">{foundCount} found</span>
              <span className="text-muted-foreground">{notFoundCount} not found</span>
            </div>
            <ScrollArea className="h-[300px] rounded-md border border-border/50">
              <div className="p-2 space-y-2">
                {fetchedDescriptions.map((result) => (
                  <div
                    key={result.id}
                    className={`p-3 rounded-lg border ${
                      result.description
                        ? 'border-green-500/20 bg-green-500/5'
                        : 'border-border/50 bg-muted/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-medium text-foreground text-sm truncate flex-1">
                        {eventsWithoutDesc.find(e => e.id === result.id)?.name || 'Unknown'}
                      </p>
                      {result.description ? (
                        <Badge variant="outline" className="text-xs border-green-500/30 text-green-500 shrink-0">
                          Found
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-border/50 text-muted-foreground shrink-0">
                          Not found
                        </Badge>
                      )}
                    </div>
                    {result.description ? (
                      <p className="text-xs text-muted-foreground line-clamp-3">
                        {result.description}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        {result.error || 'Could not extract description from page'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Saving step */}
        {enrichStep === 'saving' && (
          <div className="py-8 space-y-4">
            <div className="flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Saving descriptions and updating embeddings...
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {enrichStep === 'select' && (
            <>
              <Button
                variant="ghost"
                onClick={onClose}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                onClick={onFetchDescriptions}
                disabled={enrichSelectedIds.size === 0 || eventsWithoutDesc.length === 0}
              >
                Fetch Descriptions
              </Button>
            </>
          )}
          {enrichStep === 'preview' && (
            <>
              <Button
                variant="ghost"
                onClick={() => setEnrichStep('select')}
                className="text-muted-foreground"
              >
                Back
              </Button>
              <Button
                onClick={onSaveDescriptions}
                disabled={foundCount === 0}
              >
                Save {foundCount} Descriptions
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
