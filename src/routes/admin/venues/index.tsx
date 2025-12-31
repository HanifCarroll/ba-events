import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, useMemo, useCallback } from 'react'
import { Plus, MapPin, Search, X, Filter, Upload } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/ui/combobox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, getVenueColumns } from '@/components/data-table'
import { VenueDuplicatesPanel } from '@/components/admin/VenueDuplicatesPanel'
import { VenueAddressNamesPanel } from '@/components/admin/VenueAddressNamesPanel'
import { VenueBulkActionBar } from '@/components/admin/VenueBulkActionBar'
import { MergeVenueDialog } from '@/components/admin/MergeVenueDialog'
import { RenameVenueDialog } from '@/components/admin/RenameVenueDialog'
import { listVenues, deleteVenueAction } from '@/lib/admin'
import { useVenueReview, type ReviewTab } from '@/hooks/useVenueReview'
import { useVenueBulkActions } from '@/hooks'
import { NEIGHBORHOODS } from '@/lib/types'
import type { Venue, Neighborhood } from '@/lib/types'

export const Route = createFileRoute('/admin/venues/')({
  loader: async () => {
    return listVenues()
  },
  component: VenueListPage,
})

function VenueListPage() {
  const venues = Route.useLoaderData()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Venue review system
  const review = useVenueReview(venues)

  // Filter state
  const [search, setSearch] = useState('')
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<Neighborhood | undefined>(undefined)
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
      return true
    })
  }, [venues, search, neighborhoodFilter])

  // Bulk actions
  const bulk = useVenueBulkActions(filteredVenues)

  const hasActiveFilters = search || neighborhoodFilter

  function clearFilters() {
    setSearch('')
    setNeighborhoodFilter(undefined)
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

  // Handle selection change from DataTable
  const handleSelectionChange = useCallback(
    (newIds: Set<string>) => {
      bulk.handleSelectionChange(newIds)
    },
    [bulk]
  )

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
          <div className={`grid gap-3 ${showFilters ? 'grid' : 'hidden'} sm:grid sm:grid-cols-3`}>
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

      {/* Tabs */}
      <Tabs value={review.activeTab} onValueChange={(v) => review.setActiveTab(v as ReviewTab)}>
        <TabsList className="bg-muted/50 border border-border/50">
          <TabsTrigger value="all" className="data-[state=active]:bg-background">
            {m.admin_all_venues()}
          </TabsTrigger>
          <TabsTrigger value="duplicates" className="data-[state=active]:bg-background">
            {m.admin_duplicates()}
            {review.duplicateCount > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs bg-amber-500/20 text-amber-400">
                {review.duplicateCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="address_names" className="data-[state=active]:bg-background">
            {m.admin_address_names()}
            {review.addressNameCount > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs bg-amber-500/20 text-amber-400">
                {review.addressNameCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* All Venues Tab */}
        <TabsContent value="all" className="mt-4">
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
            <div className="relative">
              {/* Bulk action overlay */}
              <div className="absolute top-0 left-0 right-0 z-20">
                <VenueBulkActionBar
                  selectedCount={bulk.selectedIds.size}
                  filteredVenuesLength={filteredVenues.length}
                  onToggleSelectAll={bulk.toggleSelectAll}
                  onSetBulkAction={bulk.setBulkAction}
                  onClearSelection={bulk.clearSelection}
                  overlay
                />
              </div>

              <DataTable
                columns={columns}
                data={filteredVenues}
                tableId="admin-venues"
                enableRowSelection={true}
                selectedIds={bulk.selectedIds}
                onSelectionChange={handleSelectionChange}
                enableColumnResizing={true}
                enableColumnReordering={true}
                enableMultiSort={true}
                enableVirtualization={false}
              />
            </div>
          </div>
        </>
      )}
        </TabsContent>

        {/* Duplicates Tab */}
        <TabsContent value="duplicates" className="mt-4">
          <VenueDuplicatesPanel
            groups={review.duplicateGroups}
            eventCounts={review.eventCounts}
            isLoading={review.isLoadingDuplicates}
            onMerge={review.openMergeDialog}
            onRefresh={review.refetchDuplicates}
          />
        </TabsContent>

        {/* Address Names Tab */}
        <TabsContent value="address_names" className="mt-4">
          <VenueAddressNamesPanel
            venues={review.addressLikeVenues}
            venueEvents={review.addressVenueEvents}
            isLoading={review.isLoadingAddressNames}
            hasStarted={review.hasStartedAddressAnalysis}
            onRename={review.openRenameDialog}
            onRefresh={review.refetchAddressNames}
            onStart={review.startAddressAnalysis}
          />
        </TabsContent>
      </Tabs>

      {/* Merge venue dialog */}
      <MergeVenueDialog
        group={review.selectedDuplicateGroup}
        eventCounts={review.eventCounts}
        onConfirm={review.handleMerge}
        onCancel={review.closeMergeDialog}
        isLoading={review.isMerging}
      />

      {/* Rename venue dialog */}
      <RenameVenueDialog
        venue={review.selectedAddressVenue?.venue ?? null}
        suggestedName={review.selectedAddressVenue?.suggestedName}
        onConfirm={review.handleRename}
        onCancel={review.closeRenameDialog}
        isLoading={review.isRenaming}
      />

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

      {/* Bulk delete confirmation dialog */}
      <Dialog open={bulk.bulkAction === 'delete'} onOpenChange={() => bulk.setBulkAction(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{m.admin_delete_venues()}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {m.admin_delete_venues_confirm({ count: bulk.selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => bulk.setBulkAction(null)}
              className="text-muted-foreground"
            >
              {m.common_cancel()}
            </Button>
            <Button
              variant="destructive"
              onClick={bulk.handleBulkAction}
              disabled={bulk.isBulkProcessing}
            >
              {bulk.isBulkProcessing ? m.common_deleting() : m.common_delete()}
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
          {venue.neighborhood ? (
            <Badge variant="outline" className="mt-1 border-primary/30 text-primary">
              {venue.neighborhood}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground mt-1 inline-block">
              {m.admin_no_neighborhood()}
            </span>
          )}
        </div>
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
