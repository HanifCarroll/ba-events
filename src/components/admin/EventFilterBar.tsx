import { Search, Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import type { EventStatus } from '@/lib/types'
import type { VenueOption } from '@/hooks/useEventFiltering'

interface EventFilterBarProps {
  search: string
  setSearch: (value: string) => void
  statusFilter: EventStatus | 'all'
  setStatusFilter: (value: EventStatus | 'all') => void
  venueFilter: string | undefined
  setVenueFilter: (value: string | undefined) => void
  showFilters: boolean
  setShowFilters: (value: boolean) => void
  venueOptions: VenueOption[]
  hasActiveFilters: boolean
  clearFilters: () => void
}

export function EventFilterBar({
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  venueFilter,
  setVenueFilter,
  showFilters,
  setShowFilters,
  venueOptions,
  hasActiveFilters,
  clearFilters,
}: EventFilterBarProps) {
  return (
    <div className="space-y-3">
      {/* Mobile filter toggle */}
      <div className="sm:hidden">
        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className="w-full justify-between border-border/50"
        >
          <span className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                Active
              </Badge>
            )}
          </span>
          <span className="text-muted-foreground text-xs">
            {showFilters ? 'Hide' : 'Show'}
          </span>
        </Button>
      </div>

      {/* Filter controls */}
      <div className={`grid gap-3 ${showFilters ? 'grid' : 'hidden'} sm:grid sm:grid-cols-4`}>
        {/* Search */}
        <div className="relative sm:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            className="pl-9 bg-background/50 border-border/50"
          />
        </div>

        {/* Status filter */}
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as EventStatus | 'all')}
        >
          <SelectTrigger className="bg-background/50 border-border/50">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="pending_review">Pending Review</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="postponed">Postponed</SelectItem>
            <SelectItem value="past">Past</SelectItem>
          </SelectContent>
        </Select>

        {/* Venue filter */}
        <Combobox
          options={venueOptions}
          value={venueFilter}
          onValueChange={setVenueFilter}
          placeholder="All Venues"
          emptyText="No venues found"
        />
      </div>

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5 mr-1.5" />
          Clear filters
        </Button>
      )}
    </div>
  )
}
