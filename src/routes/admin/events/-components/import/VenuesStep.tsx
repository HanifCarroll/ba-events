import { useState, useCallback, useMemo } from 'react'
import { Loader2, Plus, AlertCircle, Merge, Building2, Check, ChevronDown, ChevronUp, ExternalLink, Search, MapPin } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Badge } from '@/shared/ui/badge'
import { lookupNeighborhoodsAction } from '@/features/venues/api/enrichment'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/ui/command'
import { NEIGHBORHOODS } from '@/shared/lib/types'
import type { Neighborhood } from '@/shared/lib/types'
import type { VenueLookupInput } from '@/shared/lib/streaming-types'

type VenueAction = 'create' | 'merge' | 'skip'

interface VenueEdit {
  name: string
  neighborhood: Neighborhood | null
  action: VenueAction
  mergeInto?: string  // Only used when action === 'merge'
}

interface UnmatchedVenue {
  name: string
  count: number
  eventIds: string[]
}

interface SimilarVenueMatch {
  name: string
  similarity: number
}

interface VenueEventSummary {
  id: string
  name: string
  link: string | null
}

interface ExistingVenue {
  id: string
  name: string
  neighborhood: string | null
}

interface VenuesStepProps {
  unmatchedVenues: UnmatchedVenue[]
  venueEdits: Map<string, VenueEdit>
  similarVenues: Map<string, SimilarVenueMatch[]>
  venuesToCreateCount: number
  isCreatingVenues: boolean
  totalEventsCount: number
  venueEventMap: Map<string, VenueEventSummary[]>
  venueLookupData: Map<string, VenueLookupInput>
  existingVenues: ExistingVenue[]
  onUpdateVenueEdit: (name: string, updates: Partial<VenueEdit>) => void
  onCreateVenues: () => void
  onSkip: () => void
}

export function VenuesStep({
  unmatchedVenues,
  venueEdits,
  similarVenues,
  venuesToCreateCount,
  isCreatingVenues,
  totalEventsCount: _totalEventsCount,
  venueEventMap,
  venueLookupData,
  existingVenues,
  onUpdateVenueEdit,
  onCreateVenues,
  onSkip,
}: VenuesStepProps) {
  void _totalEventsCount // Available for future display use
  // Batch selection state
  const [selectedVenueNames, setSelectedVenueNames] = useState<Set<string>>(new Set())
  // Expanded venues state
  const [expandedVenues, setExpandedVenues] = useState<Set<string>>(new Set())
  // Venue search dialog state
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [searchingForVenue, setSearchingForVenue] = useState<string | null>(null)
  // Neighborhood lookup state
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [lookupProgress, setLookupProgress] = useState<{ current: number; total: number } | null>(null)

  // Toggle single venue selection
  const toggleVenueSelect = useCallback((venueName: string) => {
    setSelectedVenueNames(prev => {
      const next = new Set(prev)
      if (next.has(venueName)) {
        next.delete(venueName)
      } else {
        next.add(venueName)
      }
      return next
    })
  }, [])

  // Toggle all venues selection
  const toggleAllVenues = useCallback(() => {
    if (selectedVenueNames.size === unmatchedVenues.length) {
      setSelectedVenueNames(new Set())
    } else {
      setSelectedVenueNames(new Set(unmatchedVenues.map(v => v.name)))
    }
  }, [selectedVenueNames.size, unmatchedVenues])

  // Apply batch action to selected venues
  const applyBatchAction = useCallback((action: VenueAction) => {
    for (const venueName of selectedVenueNames) {
      onUpdateVenueEdit(venueName, {
        action,
        mergeInto: action === 'merge' ? undefined : undefined // Reset mergeInto when not merging
      })
    }
    setSelectedVenueNames(new Set())
  }, [selectedVenueNames, onUpdateVenueEdit])

  // Toggle venue expansion
  const toggleVenueExpand = useCallback((venueName: string) => {
    setExpandedVenues(prev => {
      const next = new Set(prev)
      if (next.has(venueName)) {
        next.delete(venueName)
      } else {
        next.add(venueName)
      }
      return next
    })
  }, [])

  // Handle action change for a venue
  const handleActionChange = useCallback((venueName: string, value: string) => {
    if (value === 'create') {
      onUpdateVenueEdit(venueName, { action: 'create', mergeInto: undefined })
    } else if (value === 'skip') {
      onUpdateVenueEdit(venueName, { action: 'skip', mergeInto: undefined })
    } else if (value === 'search') {
      // Open search dialog for this venue
      setSearchingForVenue(venueName)
      setSearchDialogOpen(true)
    } else if (value.startsWith('merge:')) {
      const mergeTarget = value.replace('merge:', '')
      onUpdateVenueEdit(venueName, { action: 'merge', mergeInto: mergeTarget })
    }
  }, [onUpdateVenueEdit])

  // Handle venue selection from search dialog
  const handleSearchSelect = useCallback((selectedVenueName: string) => {
    if (searchingForVenue) {
      onUpdateVenueEdit(searchingForVenue, {
        action: 'merge',
        mergeInto: selectedVenueName
      })
    }
    setSearchDialogOpen(false)
    setSearchingForVenue(null)
  }, [searchingForVenue, onUpdateVenueEdit])

  // Handle neighborhood lookup for all venues marked for creation
  const handleLookupNeighborhoods = useCallback(async () => {
    // Get venues that need neighborhood lookup: action='create' and no neighborhood set
    // Use rich lookup data with coordinates, address, direct neighborhood when available
    const venuesToLookup = unmatchedVenues
      .filter(v => {
        const edit = venueEdits.get(v.name)
        return edit?.action === 'create' && !edit.neighborhood
      })
      .map(v => venueLookupData.get(v.name))
      .filter((v): v is VenueLookupInput => v !== undefined)

    if (venuesToLookup.length === 0) return

    setIsLookingUp(true)
    setLookupProgress({ current: 0, total: venuesToLookup.length })

    console.log(`[Neighborhood Lookup] Starting Nominatim lookups for ${venuesToLookup.length} venues`)

    try {
      // Use the tiered lookup with rich venue data (coordinates, address, direct neighborhood)
      const stream = await lookupNeighborhoodsAction({ data: { venues: venuesToLookup } })

      for await (const update of stream) {
        if (update.type === 'progress') {
          setLookupProgress({ current: update.current, total: update.total })
          if (update.neighborhood) {
            onUpdateVenueEdit(update.venueName, { neighborhood: update.neighborhood as Neighborhood })
          }
        }
      }
    } catch (error) {
      console.error('Neighborhood lookup failed:', error)
    } finally {
      setIsLookingUp(false)
      setLookupProgress(null)
    }
  }, [unmatchedVenues, venueEdits, venueLookupData, onUpdateVenueEdit])

  // Count venues eligible for neighborhood lookup
  const venuesToLookupCount = useMemo(() => {
    return unmatchedVenues.filter(v => {
      const edit = venueEdits.get(v.name)
      return edit?.action === 'create' && !edit.neighborhood
    }).length
  }, [unmatchedVenues, venueEdits])

  // Get current action value for a venue
  const getActionValue = (edit: VenueEdit | undefined): string => {
    if (!edit) return 'create'
    if (edit.action === 'merge' && edit.mergeInto) {
      return `merge:${edit.mergeInto}`
    }
    return edit.action
  }

  // Count venues by action
  const skipCount = Array.from(venueEdits.values()).filter(e => e.action === 'skip').length
  const mergeCount = Array.from(venueEdits.values()).filter(e => e.action === 'merge').length

  // Sort existing venues alphabetically for search
  const sortedExistingVenues = useMemo(() =>
    [...existingVenues].sort((a, b) => a.name.localeCompare(b.name)),
    [existingVenues]
  )

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Review Unmatched Venues
        </h2>
        <p className="text-muted-foreground">
          Choose how to handle venues that couldn't be matched automatically
        </p>
      </div>

      {/* Batch Action Toolbar (shown when venues are selected) */}
      {selectedVenueNames.size > 0 && (
        <div className="flex items-center justify-between px-4 py-3 bg-primary/10 rounded-xl border border-primary/30 animate-fade-in-up">
          <span className="text-sm font-medium">
            {selectedVenueNames.size} venue{selectedVenueNames.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => applyBatchAction('create')}
              className="bg-green-600 hover:bg-green-700"
            >
              <Plus className="h-4 w-4 mr-1" />
              Create All
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => applyBatchAction('skip')}
              className="text-muted-foreground hover:text-foreground"
            >
              Import Without Venue
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedVenueNames(new Set())}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center justify-between px-4 py-3 bg-card/50 rounded-xl border border-border/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">
              {unmatchedVenues.length} unmatched venue{unmatchedVenues.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="border-green-500/30 text-green-600">
              {venuesToCreateCount} to create
            </Badge>
            {mergeCount > 0 && (
              <Badge variant="outline" className="border-blue-500/30 text-blue-600">
                {mergeCount} to merge
              </Badge>
            )}
            {skipCount > 0 && (
              <Badge variant="outline" className="border-muted-foreground/30">
                {skipCount} without venue
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {venuesToLookupCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLookupNeighborhoods}
              disabled={isLookingUp || isCreatingVenues}
            >
              {isLookingUp ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Looking up... ({lookupProgress?.current}/{lookupProgress?.total})
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4 mr-2" />
                  Lookup Neighborhoods
                </>
              )}
            </Button>
          )}
          <Button variant="outline" onClick={onSkip}>
            Back
          </Button>
          <Button
            onClick={onCreateVenues}
            disabled={isCreatingVenues || isLookingUp || venuesToCreateCount === 0}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {isCreatingVenues ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Create & Continue
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Venues Table */}
      <div className="bg-card/50 rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={selectedVenueNames.size === unmatchedVenues.length && unmatchedVenues.length > 0}
                  onCheckedChange={toggleAllVenues}
                />
              </TableHead>
              <TableHead>Venue Name</TableHead>
              <TableHead className="w-[100px] text-center">Events</TableHead>
              <TableHead className="w-[200px]">Neighborhood</TableHead>
              <TableHead className="w-[280px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unmatchedVenues.map((venue) => {
              const edit = venueEdits.get(venue.name)
              const suggestions = similarVenues.get(venue.name) || []
              const isSkipped = edit?.action === 'skip'
              const isMerged = edit?.action === 'merge'
              const isSelected = selectedVenueNames.has(venue.name)
              const isExpanded = expandedVenues.has(venue.name)
              const events = venueEventMap.get(venue.name) || []

              return (
                <>
                  <TableRow
                    key={venue.name}
                    className={`
                      ${isSkipped ? 'opacity-50' : ''}
                      ${isMerged ? 'bg-blue-500/5' : ''}
                      ${isSelected ? 'bg-primary/5' : ''}
                    `}
                  >
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleVenueSelect(venue.name)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className={`font-medium ${isSkipped ? 'line-through text-muted-foreground' : ''}`}>
                          {venue.name}
                        </span>
                        {suggestions.length > 0 && !isSkipped && !isMerged && (
                          <span className="text-xs text-yellow-500 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Similar: {suggestions.slice(0, 2).map(s => `${s.name} (${Math.round(s.similarity * 100)}%)`).join(', ')}
                          </span>
                        )}
                        {isMerged && edit?.mergeInto && (
                          <span className="text-xs text-blue-500 flex items-center gap-1">
                            <Merge className="h-3 w-3" />
                            Will merge into "{edit.mergeInto}"
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleVenueExpand(venue.name)}
                        className="gap-1 h-7 px-2"
                      >
                        <Badge variant="secondary" className="text-xs">
                          {venue.count}
                        </Badge>
                        {isExpanded ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={edit?.neighborhood || '_unknown'}
                        onValueChange={(v) =>
                          onUpdateVenueEdit(venue.name, {
                            neighborhood: v === '_unknown' ? null : (v as Neighborhood),
                          })
                        }
                        disabled={isSkipped || isMerged}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_unknown">Unknown</SelectItem>
                          {NEIGHBORHOODS.map((n) => (
                            <SelectItem key={n} value={n}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={getActionValue(edit)}
                        onValueChange={(v) => handleActionChange(venue.name, v)}
                      >
                        <SelectTrigger className={`h-8 ${
                          edit?.action === 'create' ? 'border-green-500/50' :
                          edit?.action === 'merge' ? 'border-blue-500/50' :
                          edit?.action === 'skip' ? 'border-muted-foreground/50' : ''
                        }`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="create">
                            <div className="flex items-center gap-2">
                              <Plus className="h-4 w-4 text-green-600" />
                              <span>Create New Venue</span>
                            </div>
                          </SelectItem>
                          {suggestions.length > 0 && (
                            <>
                              <div className="px-2 py-1.5 text-xs text-muted-foreground border-t">
                                Similar venues
                              </div>
                              {suggestions.map((s) => (
                                <SelectItem key={s.name} value={`merge:${s.name}`}>
                                  <div className="flex items-center gap-2">
                                    <Merge className="h-4 w-4 text-blue-500" />
                                    <span>{s.name}</span>
                                    <Badge variant="secondary" className="ml-1 text-xs">
                                      {Math.round(s.similarity * 100)}%
                                    </Badge>
                                  </div>
                                </SelectItem>
                              ))}
                            </>
                          )}
                          <div className="px-2 py-1.5 text-xs text-muted-foreground border-t">
                            Other options
                          </div>
                          <SelectItem value="search">
                            <div className="flex items-center gap-2">
                              <Search className="h-4 w-4 text-muted-foreground" />
                              <span>Search all venues...</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="skip">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span className="w-4" />
                              <span>Import Without Venue</span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                  {/* Expanded event list */}
                  {isExpanded && events.length > 0 && (
                    <TableRow key={`${venue.name}-events`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={5} className="py-0">
                        <div className="py-3 px-4 space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            Events using this venue:
                          </div>
                          {events.map((event) => (
                            <div key={event.id} className="flex items-center gap-2 text-sm">
                              <span className="text-foreground">{event.name}</span>
                              {event.link && (
                                <a
                                  href={event.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:text-blue-400 transition-colors"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Venue Search Dialog */}
      <CommandDialog open={searchDialogOpen} onOpenChange={setSearchDialogOpen}>
        <CommandInput placeholder="Search venues..." />
        <CommandList>
          <CommandEmpty>No venues found.</CommandEmpty>
          <CommandGroup heading={`Merge "${searchingForVenue}" into:`}>
            {sortedExistingVenues.map((v) => (
              <CommandItem
                key={v.id}
                value={v.name}
                onSelect={() => handleSearchSelect(v.name)}
              >
                <span>{v.name}</span>
                {v.neighborhood && (
                  <span className="text-muted-foreground ml-2">({v.neighborhood})</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  )
}
