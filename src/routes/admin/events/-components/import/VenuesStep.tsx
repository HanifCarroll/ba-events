import { Loader2, Plus, AlertCircle, Merge, Building2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Badge } from '@/shared/ui/badge'
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
import { NEIGHBORHOODS } from '@/shared/lib/types'
import type { Neighborhood } from '@/shared/lib/types'

interface VenueEdit {
  name: string
  neighborhood: Neighborhood | null
  skip: boolean
  mergeInto?: string
}

interface UnmatchedVenue {
  name: string
  count: number
  eventIds: string[]
}

interface VenuesStepProps {
  unmatchedVenues: UnmatchedVenue[]
  venueEdits: Map<string, VenueEdit>
  similarVenues: Map<string, string[]>
  venuesToCreateCount: number
  isCreatingVenues: boolean
  totalEventsCount: number
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
  totalEventsCount,
  onUpdateVenueEdit,
  onCreateVenues,
  onSkip,
}: VenuesStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Review Venues
        </h2>
        <p className="text-muted-foreground">
          Some venues couldn't be matched. Create them or skip to proceed.
        </p>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between px-4 py-3 bg-card/50 rounded-xl border border-border/50">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">
            {unmatchedVenues.length} unmatched venue{unmatchedVenues.length !== 1 ? 's' : ''}
          </span>
          <span className="text-sm text-muted-foreground">
            ({totalEventsCount} events total)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onSkip}>
            Skip
          </Button>
          <Button
            onClick={onCreateVenues}
            disabled={isCreatingVenues || venuesToCreateCount === 0}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {isCreatingVenues ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create {venuesToCreateCount} Venue{venuesToCreateCount !== 1 ? 's' : ''}
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
              <TableHead className="w-[50px]">Skip</TableHead>
              <TableHead>Venue Name</TableHead>
              <TableHead className="w-[100px]">Events</TableHead>
              <TableHead className="w-[200px]">Neighborhood</TableHead>
              <TableHead className="w-[250px]">Merge Into</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unmatchedVenues.map((venue) => {
              const edit = venueEdits.get(venue.name)
              const suggestions = similarVenues.get(venue.name) || []
              const isMerged = edit?.mergeInto !== undefined

              return (
                <TableRow
                  key={venue.name}
                  className={edit?.skip ? 'opacity-50' : isMerged ? 'bg-blue-500/5' : ''}
                >
                  <TableCell>
                    <Checkbox
                      checked={edit?.skip || false}
                      onCheckedChange={(checked) =>
                        onUpdateVenueEdit(venue.name, { skip: !!checked, mergeInto: undefined })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className={`font-medium ${edit?.skip ? 'line-through' : ''}`}>
                        {venue.name}
                      </span>
                      {suggestions.length > 0 && !edit?.skip && !isMerged && (
                        <span className="text-xs text-yellow-500 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          Similar to: {suggestions.join(', ')}
                        </span>
                      )}
                      {isMerged && (
                        <span className="text-xs text-blue-500 flex items-center gap-1">
                          <Merge className="h-3 w-3" />
                          Will merge into "{edit.mergeInto}"
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {venue.count}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={edit?.neighborhood || '_unknown'}
                      onValueChange={(v) =>
                        onUpdateVenueEdit(venue.name, {
                          neighborhood: v === '_unknown' ? null : (v as Neighborhood),
                        })
                      }
                      disabled={edit?.skip || isMerged}
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
                    {suggestions.length > 0 ? (
                      <Select
                        value={edit?.mergeInto || '_none'}
                        onValueChange={(v) =>
                          onUpdateVenueEdit(venue.name, {
                            mergeInto: v === '_none' ? undefined : v,
                          })
                        }
                        disabled={edit?.skip}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Don't merge" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Don't merge</SelectItem>
                          {suggestions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
