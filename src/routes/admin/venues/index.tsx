import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { Plus, MapPin, Search, X, Filter, Users, Upload } from 'lucide-react'
import * as m from '@/paraglide/messages'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, getVenueColumns } from '@/components/data-table'
import { listVenues, deleteVenueAction } from '@/lib/admin'
import { NEIGHBORHOODS, VENUE_TYPES } from '@/lib/types'
import type { Venue, Neighborhood, VenueType } from '@/lib/types'

export const Route = createFileRoute('/admin/venues/')({
  loader: async () => {
    return listVenues()
  },
  component: VenueListPage,
})

function getVenueTypeLabel(type: string): string {
  const labels: Record<string, () => string> = {
    club: () => m.admin_venue_type_club(),
    bar: () => m.admin_venue_type_bar(),
    theater: () => m.admin_venue_type_theater(),
    gallery: () => m.admin_venue_type_gallery(),
    cultural_center: () => m.admin_venue_type_cultural_center(),
    outdoor: () => m.admin_venue_type_outdoor(),
    restaurant: () => m.admin_venue_type_restaurant(),
    other: () => m.admin_venue_type_other(),
  }
  return labels[type]?.() || type
}

function VenueListPage() {
  const venues = Route.useLoaderData()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Filter state
  const [search, setSearch] = useState('')
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<Neighborhood | undefined>(undefined)
  const [typeFilter, setTypeFilter] = useState<VenueType | 'all'>('all')
  const [showFilters, setShowFilters] = useState(false)

  // Neighborhood options for combobox
  const neighborhoodOptions = useMemo(() => {
    return NEIGHBORHOODS.map((n) => ({ value: n, label: n }))
  }, [])

  // Filter venues
  const filteredVenues = useMemo(() => {
    return venues.filter((venue) => {
      // Search filter
      if (search && !venue.name.toLowerCase().includes(search.toLowerCase())) {
        return false
      }
      // Neighborhood filter
      if (neighborhoodFilter && venue.neighborhood !== neighborhoodFilter) {
        return false
      }
      // Type filter
      if (typeFilter !== 'all' && venue.type !== typeFilter) {
        return false
      }
      return true
    })
  }, [venues, search, neighborhoodFilter, typeFilter])

  const hasActiveFilters = search || neighborhoodFilter || typeFilter !== 'all'

  function clearFilters() {
    setSearch('')
    setNeighborhoodFilter(undefined)
    setTypeFilter('all')
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      await deleteVenueAction({ data: deleteTarget.id })
      setDeleteTarget(null)
      router.invalidate()
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  // Column definitions with delete handler
  const columns = useMemo(
    () => getVenueColumns({ onDelete: setDeleteTarget }),
    []
  )

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" />
            {m.admin_venues_title()}
          </h1>
          <p className="text-muted-foreground mt-1">
            {hasActiveFilters
              ? m.admin_venues_filtered({ filtered: filteredVenues.length, total: venues.length })
              : m.admin_venues_count({ count: venues.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="border-border/50">
            <Link to="/admin/venues/import">
              <Upload className="h-4 w-4 mr-2" />
              {m.admin_import_csv()}
            </Link>
          </Button>
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/admin/venues/new">
              <Plus className="h-4 w-4 mr-2" />
              {m.admin_add_venue()}
            </Link>
          </Button>
        </div>
      </div>

      <div className="deco-line w-24" />

      {/* Filter Bar */}
      {venues.length > 0 && (
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
                {m.common_filters()}
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {m.common_active()}
                  </Badge>
                )}
              </span>
              <span className="text-muted-foreground text-xs">
                {showFilters ? m.common_hide() : m.common_show()}
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
                placeholder={m.admin_search_venues()}
                className="pl-9 bg-background/50 border-border/50"
              />
            </div>

            {/* Neighborhood filter */}
            <Combobox
              options={neighborhoodOptions}
              value={neighborhoodFilter}
              onValueChange={(v) => setNeighborhoodFilter(v as Neighborhood | undefined)}
              placeholder={m.admin_all_neighborhoods()}
              emptyText={m.admin_no_neighborhood()}
            />

            {/* Type filter */}
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as VenueType | 'all')}
            >
              <SelectTrigger className="bg-background/50 border-border/50">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{m.admin_all_types()}</SelectItem>
                {VENUE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {getVenueTypeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              {m.common_clear_filters()}
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      {venues.length === 0 ? (
        <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
          <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground mb-2">{m.admin_no_venues()}</h3>
          <p className="text-muted-foreground mb-4">{m.admin_no_venues_desc()}</p>
          <Button asChild className="bg-primary text-primary-foreground">
            <Link to="/admin/venues/new">
              <Plus className="h-4 w-4 mr-2" />
              {m.admin_add_venue()}
            </Link>
          </Button>
        </div>
      ) : filteredVenues.length === 0 ? (
        <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
          <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground mb-2">{m.admin_no_matching_venues()}</h3>
          <p className="text-muted-foreground mb-4">{m.admin_no_matching_desc()}</p>
          <Button variant="outline" onClick={clearFilters}>
            {m.common_clear_filters()}
          </Button>
        </div>
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="sm:hidden space-y-3">
            {filteredVenues.map((venue) => (
              <MobileVenueCard
                key={venue.id}
                venue={venue}
                onDelete={() => setDeleteTarget(venue)}
              />
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block">
            <DataTable
              columns={columns}
              data={filteredVenues}
              tableId="admin-venues"
              enableRowSelection={false}
              enableColumnResizing={true}
              enableColumnReordering={true}
              enableMultiSort={true}
              enableVirtualization={false}
            />
          </div>
        </>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{m.admin_delete_venue()}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {m.admin_delete_venue_confirm({ name: deleteTarget?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              className="text-muted-foreground"
            >
              {m.common_cancel()}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? m.common_deleting() : m.common_delete()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Mobile venue card component
function MobileVenueCard({
  venue,
  onDelete,
}: {
  venue: Venue
  onDelete: () => void
}) {
  return (
    <div className="bg-card/50 rounded-xl border border-border/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground truncate">{venue.name}</p>
          <Badge variant="outline" className="mt-1 border-primary/30 text-primary">
            {venue.neighborhood}
          </Badge>
        </div>
        <Badge variant="outline" className="shrink-0 border-border/50 text-muted-foreground">
          {getVenueTypeLabel(venue.type)}
        </Badge>
      </div>

      <div className="text-sm text-muted-foreground">
        {venue.capacity && (
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span>{m.admin_capacity({ count: venue.capacity })}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border/30">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="flex-1 text-muted-foreground hover:text-foreground"
        >
          <Link to="/admin/venues/$id" params={{ id: venue.id }}>
            {m.common_edit()}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          {m.common_delete()}
        </Button>
      </div>
    </div>
  )
}
