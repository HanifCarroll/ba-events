import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { z } from 'zod'

// Simple debounce utility
function debounce<T extends (...args: Parameters<T>) => void>(
  func: T,
  wait: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), wait)
  }
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId)
  }
  return debounced as T & { cancel: () => void }
}
import { Plus, MapPin, Search, X, Filter, Upload, Loader2, AlertCircle, ChevronDown, ChevronRight, ExternalLink, Pencil } from 'lucide-react'
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { DataTable, getVenueColumns } from '@/components/data-table'
import { VenueDuplicatesPanel } from '@/components/admin/VenueDuplicatesPanel'
import { VenueAddressNamesPanel } from '@/components/admin/VenueAddressNamesPanel'
import { VenueBulkActionBar } from '@/components/admin/VenueBulkActionBar'
import { MergeVenueDialog } from '@/components/admin/MergeVenueDialog'
import { RenameVenueDialog } from '@/components/admin/RenameVenueDialog'
import { DismissedDuplicatesDialog } from '@/components/admin/DismissedDuplicatesDialog'
import { listVenues, deleteVenueAction } from '@/lib/admin'
import { useVenueReview } from '@/hooks/useVenueReview'
import { useVenueBulkActions, useVenueNominatimEnrichment } from '@/hooks'
import { NEIGHBORHOODS } from '@/lib/types'
import type { Venue, Neighborhood } from '@/lib/types'
import type { ReviewTab } from '@/hooks/useVenueReview'

// URL search params schema
const venueSearchSchema = z.object({
  tab: z.enum(['all', 'missing_neighborhood', 'duplicates', 'address_names']).optional().catch('all'),
  search: z.string().optional(),
  neighborhood: z.string().optional(),
})

export type VenueSearchParams = z.infer<typeof venueSearchSchema>

export const Route = createFileRoute('/admin/venues/')({
  validateSearch: venueSearchSchema,
  loader: async () => {
    return listVenues()
  },
  component: VenueListPage,
})

function VenueListPage() {
  const venues = Route.useLoaderData()
  const router = useRouter()
  const searchParams = Route.useSearch()
  const navigate = Route.useNavigate()
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // URL-derived state
  const activeTab = (searchParams.tab || 'all') as ReviewTab
  const search = searchParams.search || ''
  const neighborhoodFilter = searchParams.neighborhood as Neighborhood | undefined

  // Tab change - clears filters
  const setActiveTab = useCallback(
    (tab: ReviewTab) => {
      navigate({
        search: { tab },
      })
      setSearchInput('')
    },
    [navigate]
  )

  // Venue review system
  const review = useVenueReview({ venues, activeTab, setActiveTab })

  // Local state for UI
  const [showFilters, setShowFilters] = useState(false)
  const [searchInput, setSearchInput] = useState(search)

  // Sync search input when URL changes
  useEffect(() => {
    setSearchInput(search)
  }, [search])

  // Debounced search update
  const debouncedSearchUpdate = useMemo(
    () =>
      debounce((value: string) => {
        navigate({
          search: (prev) => ({ ...prev, search: value || undefined }),
          replace: true,
        })
      }, 300),
    [navigate]
  )

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => debouncedSearchUpdate.cancel()
  }, [debouncedSearchUpdate])

  // Handle search input change
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchInput(value)
      debouncedSearchUpdate(value)
    },
    [debouncedSearchUpdate]
  )

  // Handle neighborhood filter change
  const handleNeighborhoodChange = useCallback(
    (value: string | undefined) => {
      navigate({
        search: (prev) => ({ ...prev, neighborhood: value }),
        replace: true,
      })
    },
    [navigate]
  )

  // Neighborhood options for combobox
  const neighborhoodOptions = useMemo(() => {
    return NEIGHBORHOODS.map((n) => ({ value: n, label: n }))
  }, [])

  // Venue enrichment state (declare before filteredVenues since filter depends on it)
  const enrichment = useVenueNominatimEnrichment()
  const [enrichErrorsOpen, setEnrichErrorsOpen] = useState(false)
  const [expandedVenues, setExpandedVenues] = useState<Set<string>>(new Set())
  const [failedVenueFilter, setFailedVenueFilter] = useState<Set<string> | null>(null)

  // Filter venues
  const filteredVenues = useMemo(() => {
    return venues.filter((venue) => {
      // Failed venue filter (from enrichment summary)
      if (failedVenueFilter && !failedVenueFilter.has(venue.id)) {
        return false
      }
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
  }, [venues, search, neighborhoodFilter, failedVenueFilter])

  // Bulk actions
  const bulk = useVenueBulkActions(filteredVenues)

  const hasActiveFilters = search || neighborhoodFilter || failedVenueFilter

  // Get count of venues that can be enriched from selection
  const enrichableVenues = useMemo(() => {
    return enrichment.getEnrichableVenues(filteredVenues, bulk.selectedIds)
  }, [enrichment, filteredVenues, bulk.selectedIds])

  const clearFilters = useCallback(() => {
    navigate({
      search: { tab: activeTab },
    })
    setSearchInput('')
    setFailedVenueFilter(null)
  }, [navigate, activeTab])

  async function handleEnrichment() {
    await enrichment.enrichVenues(filteredVenues, bulk.selectedIds, () => {
      // Keep dialog open to show results
    })
  }

  function handleCloseEnrichDialog() {
    bulk.setBulkAction(null)
    enrichment.clearResult()
    setEnrichErrorsOpen(false)
    setExpandedVenues(new Set())
  }

  function handleViewFailedVenues() {
    if (!enrichment.enrichResult) return
    const failedIds = new Set(enrichment.enrichResult.errors.map((e) => e.venueId))
    setFailedVenueFilter(failedIds)
    handleCloseEnrichDialog()
  }

  function toggleVenueExpanded(venueId: string) {
    setExpandedVenues((prev) => {
      const next = new Set(prev)
      if (next.has(venueId)) {
        next.delete(venueId)
      } else {
        next.add(venueId)
      }
      return next
    })
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
                value={searchInput}
                onChange={handleSearchChange}
                placeholder={m.admin_search_venues()}
                className="pl-9 bg-background/50 border-border/50"
              />
            </div>

            {/* Neighborhood filter */}
            <Combobox
              options={neighborhoodOptions}
              value={neighborhoodFilter}
              onValueChange={handleNeighborhoodChange}
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
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReviewTab)}>
        <TabsList className="bg-muted/50 border border-border/50">
          <TabsTrigger value="all" className="data-[state=active]:bg-background">
            {m.admin_all_venues()}
          </TabsTrigger>
          <TabsTrigger value="missing_neighborhood" className="data-[state=active]:bg-background">
            {m.admin_tab_missing_neighborhood()}
            {review.missingNeighborhoodCount > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs bg-amber-500/20 text-amber-400">
                {review.missingNeighborhoodCount}
              </Badge>
            )}
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
                  isAllSelected={filteredVenues.length > 0 && bulk.selectedIds.size === filteredVenues.length}
                  onToggleSelectAll={bulk.toggleSelectAll}
                  onSetBulkAction={bulk.setBulkAction}
                  onClearSelection={bulk.clearSelection}
                  overlay
                  enrichableCount={enrichableVenues.length}
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

        {/* Missing Neighborhood Tab */}
        <TabsContent value="missing_neighborhood" className="mt-4">
          {review.missingNeighborhoodVenues.length === 0 ? (
            <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
              <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-display text-lg font-medium text-foreground mb-2">
                {m.admin_no_missing_neighborhood()}
              </h3>
              <p className="text-muted-foreground">{m.admin_no_missing_neighborhood_desc()}</p>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="sm:hidden space-y-3">
                {review.missingNeighborhoodVenues.map((venue) => (
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
                      isAllSelected={review.missingNeighborhoodVenues.length > 0 && bulk.selectedIds.size === review.missingNeighborhoodVenues.length}
                      onToggleSelectAll={() => {
                        if (bulk.selectedIds.size === review.missingNeighborhoodVenues.length) {
                          bulk.clearSelection()
                        } else {
                          const allIds = new Set(review.missingNeighborhoodVenues.map(v => v.id))
                          bulk.handleSelectionChange(allIds)
                        }
                      }}
                      onSetBulkAction={bulk.setBulkAction}
                      onClearSelection={bulk.clearSelection}
                      overlay
                      enrichableCount={enrichableVenues.length}
                    />
                  </div>

                  <DataTable
                    columns={columns}
                    data={review.missingNeighborhoodVenues}
                    tableId="admin-venues-missing-neighborhood"
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
            onDismiss={review.handleDismiss}
            onShowDismissed={() => review.setShowDismissedDialog(true)}
            dismissedCount={review.dismissedCount}
            isDismissing={review.isDismissing}
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

      {/* Dismissed duplicates dialog */}
      <DismissedDuplicatesDialog
        open={review.showDismissedDialog}
        onOpenChange={review.setShowDismissedDialog}
        dismissedPairs={review.dismissedDuplicates}
        isLoading={review.isLoadingDismissed}
        onRestore={review.handleRestore}
        isRestoring={review.isRestoring}
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

      {/* Venue enrichment dialog */}
      <Dialog open={bulk.bulkAction === 'enrich'} onOpenChange={handleCloseEnrichDialog}>
        <DialogContent className="bg-card border-border/50 max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              {m.admin_enrich_venues()}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {enrichment.enrichResult
                ? m.admin_enrich_complete()
                : m.admin_enrich_venues_desc({ count: enrichableVenues.length })}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {/* Pre-enrichment: show estimated time */}
            {!enrichment.isEnriching && !enrichment.enrichResult && enrichableVenues.length > 0 && (
              <div className="text-sm text-muted-foreground">
                {m.admin_enrich_estimated_time({ seconds: enrichableVenues.length })}
              </div>
            )}

            {/* No venues to enrich */}
            {!enrichment.isEnriching && !enrichment.enrichResult && enrichableVenues.length === 0 && (
              <div className="flex items-center gap-2 text-amber-500">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">All selected venues already have address and neighborhood data.</span>
              </div>
            )}

            {/* During enrichment: progress bar */}
            {enrichment.isEnriching && (
              <div className="space-y-3">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{
                      width: enrichment.enrichProgress.total > 0
                        ? `${(enrichment.enrichProgress.current / enrichment.enrichProgress.total) * 100}%`
                        : '0%'
                    }}
                  />
                </div>
                <p className="text-sm text-center text-muted-foreground">
                  {m.admin_enrich_progress({
                    current: enrichment.enrichProgress.current,
                    total: enrichment.enrichProgress.total
                  })}
                </p>
              </div>
            )}

            {/* After enrichment: results summary */}
            {enrichment.enrichResult && (
              <div className="space-y-4">
                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-green-500/10 rounded-lg">
                    <p className="text-2xl font-bold text-green-600">{enrichment.enrichResult.enriched}</p>
                    <p className="text-xs text-muted-foreground">{m.admin_enrich_stat_enriched()}</p>
                  </div>
                  <div className="text-center p-3 bg-amber-500/10 rounded-lg">
                    <p className="text-2xl font-bold text-amber-600">{enrichment.enrichResult.errors.length}</p>
                    <p className="text-xs text-muted-foreground">{m.admin_enrich_stat_errors()}</p>
                  </div>
                </div>

                {/* Errors list with events */}
                {enrichment.enrichResult.errors.length > 0 && (
                  <Collapsible open={enrichErrorsOpen} onOpenChange={setEnrichErrorsOpen}>
                    <CollapsibleTrigger className="flex items-center justify-between w-full text-sm p-2 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                      <span className="flex items-center gap-2 font-medium">
                        {enrichErrorsOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        {m.admin_enrich_failed_venues()}
                      </span>
                      <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                        {enrichment.enrichResult.errors.length}
                      </Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                      {enrichment.enrichResult.errors.map((err) => {
                        const venueEventsList = enrichment.venueEvents[err.venueId] || []
                        const isExpanded = expandedVenues.has(err.venueId)

                        return (
                          <div key={err.venueId} className="bg-muted/30 rounded-lg border border-border/30">
                            {/* Venue header */}
                            <div className="flex items-center justify-between p-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {venueEventsList.length > 0 && (
                                    <button
                                      onClick={() => toggleVenueExpanded(err.venueId)}
                                      className="text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </button>
                                  )}
                                  <span className="font-medium text-foreground truncate">{err.venueName}</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 ml-6">{err.error}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                className="text-muted-foreground hover:text-foreground shrink-0"
                              >
                                <Link to="/admin/venues/$id" params={{ id: err.venueId }}>
                                  <Pencil className="h-3.5 w-3.5 mr-1" />
                                  {m.common_edit()}
                                </Link>
                              </Button>
                            </div>

                            {/* Events list (collapsible) */}
                            {isExpanded && venueEventsList.length > 0 && (
                              <div className="px-3 pb-3 pt-1 border-t border-border/30">
                                <p className="text-xs text-muted-foreground mb-2">
                                  {m.admin_enrich_events_at_venue({ count: venueEventsList.length })}
                                </p>
                                <div className="space-y-1.5">
                                  {venueEventsList.slice(0, 5).map((event) => (
                                    <div key={event.id} className="flex items-center justify-between text-xs">
                                      <span className="truncate text-foreground">{event.name}</span>
                                      <div className="flex items-center gap-2 shrink-0 ml-2">
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                          {event.source}
                                        </Badge>
                                        {event.link && (
                                          <a
                                            href={event.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:text-primary/80"
                                          >
                                            <ExternalLink className="h-3 w-3" />
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {venueEventsList.length > 5 && (
                                    <p className="text-xs text-muted-foreground">
                                      {m.admin_enrich_more_events({ count: venueEventsList.length - 5 })}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {!enrichment.enrichResult ? (
              <>
                <Button
                  variant="ghost"
                  onClick={handleCloseEnrichDialog}
                  disabled={enrichment.isEnriching}
                  className="text-muted-foreground"
                >
                  {m.common_cancel()}
                </Button>
                <Button
                  onClick={handleEnrichment}
                  disabled={enrichment.isEnriching || enrichableVenues.length === 0}
                >
                  {enrichment.isEnriching ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {m.admin_enriching_venues()}
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4 mr-2" />
                      Add Neighborhoods ({enrichableVenues.length})
                    </>
                  )}
                </Button>
              </>
            ) : (
              <div className="flex gap-2 w-full sm:w-auto">
                {enrichment.enrichResult.errors.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={handleViewFailedVenues}
                    className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    {m.admin_enrich_view_failed()} ({enrichment.enrichResult.errors.length})
                  </Button>
                )}
                <Button onClick={handleCloseEnrichDialog}>
                  {m.admin_enrich_done()}
                </Button>
              </div>
            )}
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
