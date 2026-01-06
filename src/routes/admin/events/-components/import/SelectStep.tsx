import { useMemo, useState, useCallback } from 'react'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { ArrowRight, MapPin, AlertTriangle, Eye, EyeOff, Plus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Switch } from '@/shared/ui/switch'
import { Label } from '@/shared/ui/label'
import { DataTable, getPasslineColumns, getEventbriteColumns, getCSVColumns, getBaTourismColumns, getMeetupColumns, getLumaColumns } from '@/shared/ui/data-table'
import type { ParsedCSVRowWithId, PasslineEventWithId, EventbriteEventWithId, BaTourismEventWithId, MeetupEventWithId, LumaEventWithId, ImportTableMeta } from '@/shared/ui/data-table'
import type { PasslinePreviewEvent, EventbritePreviewEvent, BATourismPreviewEvent, MeetupPreviewEvent, LumaPreviewEvent, DuplicateInfo } from '@/features/import'
import type { ImportSource } from '@/features/import'
import { DiffViewerDialog } from './DiffViewerDialog'

interface ParsedCSVRow {
  rowNumber: number
  data: {
    name?: string
    starts_at?: string
    venue_name?: string
    categories?: string
  }
  errors: string[]
}

interface SelectStepProps {
  source: ImportSource
  passlineEvents: PasslinePreviewEvent[]
  eventbriteEvents: EventbritePreviewEvent[]
  baTourismEvents: BATourismPreviewEvent[]
  meetupEvents: MeetupPreviewEvent[]
  lumaEvents: LumaPreviewEvent[]
  csvRows: ParsedCSVRow[]
  csvValidCount: number
  csvErrorCount: number
  csvAllValid: boolean
  selectedIds: Set<string>
  unmatchedVenueCount: number
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onProceed: () => void
  // Inline venue decision callbacks
  onCreateAllVenues?: () => void
  onReviewVenues?: () => void
  onSkipVenues?: () => void
  isCreatingVenues?: boolean
}

export function SelectStep({
  source,
  passlineEvents,
  eventbriteEvents,
  baTourismEvents,
  meetupEvents,
  lumaEvents,
  csvRows,
  csvErrorCount,
  csvAllValid,
  selectedIds,
  unmatchedVenueCount,
  onToggleSelect,
  onProceed,
  onCreateAllVenues,
  onReviewVenues,
  onSkipVenues,
  isCreatingVenues,
}: SelectStepProps) {
  const [diffDialogOpen, setDiffDialogOpen] = useState(false)
  const [selectedDiff, setSelectedDiff] = useState<DuplicateInfo | null>(null)
  // Column filter state for hiding duplicates - default to hiding them
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([
    { id: 'alreadyImported', value: 'no' }
  ])

  // Derived state: are duplicates currently shown?
  const showDuplicates = !columnFilters.some(f => f.id === 'alreadyImported' && f.value === 'no')

  // Toggle handler for showing/hiding duplicates
  const handleToggleDuplicates = useCallback((show: boolean) => {
    setColumnFilters(show ? [] : [{ id: 'alreadyImported', value: 'no' }])
  }, [])

  const isPassline = source === 'passline'
  const isEventbrite = source === 'eventbrite'
  const isBaTourism = source === 'ba-tourism'
  const isMeetup = source === 'meetup'
  const isLuma = source === 'luma'
  const isApiSource = isPassline || isEventbrite || isBaTourism || isMeetup || isLuma

  // Get total count (unfiltered)
  const totalCount = isPassline
    ? passlineEvents.length
    : isEventbrite
      ? eventbriteEvents.length
      : isBaTourism
        ? baTourismEvents.length
        : isMeetup
          ? meetupEvents.length
          : isLuma
            ? lumaEvents.length
            : csvRows.length

  // Calculate already imported count for all sources
  const alreadyImportedCount = useMemo(() => {
    if (isPassline) return passlineEvents.filter(e => e.alreadyImported).length
    if (isEventbrite) return eventbriteEvents.filter(e => e.alreadyImported).length
    if (isBaTourism) return baTourismEvents.filter(e => e.alreadyImported).length
    if (isMeetup) return meetupEvents.filter(e => e.alreadyImported).length
    if (isLuma) return lumaEvents.filter(e => e.alreadyImported).length
    return 0
  }, [isPassline, isEventbrite, isBaTourism, isMeetup, isLuma, passlineEvents, eventbriteEvents, baTourismEvents, meetupEvents, lumaEvents])

  // Handler for viewing diff - passed to DataTable via meta
  const handleViewDiff = useCallback((duplicateInfo: DuplicateInfo) => {
    setSelectedDiff(duplicateInfo)
    setDiffDialogOpen(true)
  }, [])

  // Table meta with diff handler
  const tableMeta: ImportTableMeta = useMemo(() => ({
    onViewDiff: handleViewDiff,
  }), [handleViewDiff])

  // Transform data to include id field for DataTable compatibility
  // No filtering here - DataTable handles filtering via columnFilters
  const passlineData = useMemo((): PasslineEventWithId[] => {
    return passlineEvents.map((event) => ({
      ...event,
      id: event.passline.id,
    }))
  }, [passlineEvents])

  const eventbriteData = useMemo((): EventbriteEventWithId[] => {
    return eventbriteEvents.map((event) => ({
      ...event,
      id: event.eventbrite.url, // Use URL as unique ID
    }))
  }, [eventbriteEvents])

  const baTourismData = useMemo((): BaTourismEventWithId[] => {
    return baTourismEvents.map((event) => ({
      ...event,
      id: `ba-tourism-${event.baTourism.name}`,
    }))
  }, [baTourismEvents])

  const meetupData = useMemo((): MeetupEventWithId[] => {
    return meetupEvents.map((event) => ({
      ...event,
      id: event.meetup.id,
    }))
  }, [meetupEvents])

  const lumaData = useMemo((): LumaEventWithId[] => {
    return lumaEvents.map((event) => ({
      ...event,
      id: event.luma.api_id,
    }))
  }, [lumaEvents])

  const csvData = useMemo((): ParsedCSVRowWithId[] => {
    return csvRows.map((row, index) => ({
      ...row,
      id: `csv-${index}`,
    }))
  }, [csvRows])

  // Get visible count based on filter state
  // When hiding duplicates: total - duplicates, otherwise total
  const visibleCount = isApiSource
    ? (showDuplicates ? totalCount : totalCount - alreadyImportedCount)
    : csvData.length

  const canProceed = isApiSource
    ? selectedIds.size > 0 && unmatchedVenueCount === 0
    : (csvAllValid && selectedIds.size > 0)

  // Get column definitions
  const passlineColumns = useMemo(() => getPasslineColumns(), [])
  const eventbriteColumns = useMemo(() => getEventbriteColumns(), [])
  const baTourismColumns = useMemo(() => getBaTourismColumns(), [])
  const meetupColumns = useMemo(() => getMeetupColumns(), [])
  const lumaColumns = useMemo(() => getLumaColumns(), [])
  const csvColumns = useMemo(() => getCSVColumns(), [])

  // Handle selection change
  const handleSelectionChange = (newIds: Set<string>) => {
    // Find added/removed ids
    const added = [...newIds].filter((id) => !selectedIds.has(id))
    const removed = [...selectedIds].filter((id) => !newIds.has(id))

    // Toggle each changed id
    added.forEach((id) => onToggleSelect(id))
    removed.forEach((id) => onToggleSelect(id))
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Select Events to Import
        </h2>
        <p className="text-muted-foreground">
          Choose which events you want to import
        </p>
      </div>

      {/* Inline Venue Decision */}
      {unmatchedVenueCount > 0 && isApiSource && (
        <div className="space-y-4 px-4 py-4 bg-amber-500/10 rounded-xl border border-amber-500/30">
          {/* Warning header */}
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {unmatchedVenueCount} event{unmatchedVenueCount !== 1 ? 's' : ''} have unmatched venues
              </p>
              <p className="text-xs text-muted-foreground">
                Choose how to handle these venues before importing
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            {onCreateAllVenues && (
              <Button
                variant="default"
                size="sm"
                onClick={onCreateAllVenues}
                disabled={isCreatingVenues}
                className="bg-primary text-primary-foreground"
              >
                <Plus className="h-4 w-4 mr-2" />
                {isCreatingVenues ? 'Creating...' : 'Create All as New'}
              </Button>
            )}

            {onReviewVenues && (
              <Button
                variant="outline"
                size="sm"
                onClick={onReviewVenues}
                disabled={isCreatingVenues}
                className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
              >
                <MapPin className="h-4 w-4 mr-2" />
                Review & Merge
              </Button>
            )}

            {onSkipVenues && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSkipVenues}
                disabled={isCreatingVenues}
                className="text-muted-foreground hover:text-foreground"
              >
                Import Without Venues
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Already Imported Toggle - Universal for all sources */}
      {alreadyImportedCount > 0 && isApiSource && (
        <div className="flex items-center justify-between px-4 py-3 bg-blue-500/10 rounded-xl border border-blue-500/30">
          <div className="flex items-center gap-3">
            {showDuplicates ? (
              <Eye className="h-5 w-5 text-blue-500" />
            ) : (
              <EyeOff className="h-5 w-5 text-blue-500" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                {showDuplicates ? 'Showing' : 'Hiding'} {alreadyImportedCount} already imported event{alreadyImportedCount !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {showDuplicates
                  ? 'Select duplicates to re-import and update existing records.'
                  : 'Toggle to show duplicates if you want to re-import them.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="show-duplicates" className="text-sm text-muted-foreground">
              Show duplicates
            </Label>
            <Switch
              id="show-duplicates"
              checked={showDuplicates}
              onCheckedChange={handleToggleDuplicates}
            />
          </div>
        </div>
      )}

      {/* Summary & Proceed */}
      <div className="flex items-center justify-between px-4 py-3 bg-card/50 rounded-xl border border-border/50">
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="border-primary/30 text-primary">
            {selectedIds.size} selected
          </Badge>
          <span className="text-sm text-muted-foreground">
            of {visibleCount} event{visibleCount !== 1 ? 's' : ''}
            {!showDuplicates && alreadyImportedCount > 0 && isApiSource && (
              <span className="text-muted-foreground/70"> ({totalCount} total)</span>
            )}
          </span>
          {!isApiSource && csvErrorCount > 0 && (
            <Badge variant="outline" className="border-destructive/30 text-destructive">
              {csvErrorCount} with errors
            </Badge>
          )}
        </div>
        <Button
          onClick={onProceed}
          disabled={!canProceed}
          className="bg-primary text-primary-foreground"
        >
          Continue
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>

      {/* Events Table */}
      {isPassline ? (
        <DataTable
          columns={passlineColumns}
          data={passlineData}
          tableId="import-passline"
          enableRowSelection={true}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
          enableColumnResizing={true}
          enableColumnReordering={true}
          enableMultiSort={true}
          enableVirtualization={false}
          enableColumnFiltering={true}
          columnFilters={columnFilters}
          onColumnFiltersChange={setColumnFilters}
          meta={tableMeta}
        />
      ) : isEventbrite ? (
        <DataTable
          columns={eventbriteColumns}
          data={eventbriteData}
          tableId="import-eventbrite"
          enableRowSelection={true}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
          enableColumnResizing={true}
          enableColumnReordering={true}
          enableMultiSort={true}
          enableVirtualization={false}
          enableColumnFiltering={true}
          columnFilters={columnFilters}
          onColumnFiltersChange={setColumnFilters}
          meta={tableMeta}
        />
      ) : isBaTourism ? (
        <DataTable
          columns={baTourismColumns}
          data={baTourismData}
          tableId="import-ba-tourism"
          enableRowSelection={true}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
          enableColumnResizing={true}
          enableColumnReordering={true}
          enableMultiSort={true}
          enableVirtualization={false}
          enableColumnFiltering={true}
          columnFilters={columnFilters}
          onColumnFiltersChange={setColumnFilters}
          meta={tableMeta}
        />
      ) : isMeetup ? (
        <DataTable
          columns={meetupColumns}
          data={meetupData}
          tableId="import-meetup"
          enableRowSelection={true}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
          enableColumnResizing={true}
          enableColumnReordering={true}
          enableMultiSort={true}
          enableVirtualization={false}
          enableColumnFiltering={true}
          columnFilters={columnFilters}
          onColumnFiltersChange={setColumnFilters}
          meta={tableMeta}
        />
      ) : isLuma ? (
        <DataTable
          columns={lumaColumns}
          data={lumaData}
          tableId="import-luma"
          enableRowSelection={true}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
          enableColumnResizing={true}
          enableColumnReordering={true}
          enableMultiSort={true}
          enableVirtualization={false}
          enableColumnFiltering={true}
          columnFilters={columnFilters}
          onColumnFiltersChange={setColumnFilters}
          meta={tableMeta}
        />
      ) : (
        <>
          <DataTable
            columns={csvColumns}
            data={csvData}
            tableId="import-csv"
            enableRowSelection={true}
            selectedIds={selectedIds}
            onSelectionChange={handleSelectionChange}
            enableColumnResizing={true}
            enableColumnReordering={true}
            enableMultiSort={true}
            enableVirtualization={false}
            rowClassName={(row) =>
              row.original.errors.length > 0 ? 'bg-destructive/5' : ''
            }
          />
          {!csvAllValid && (
            <p className="text-sm text-muted-foreground text-center">
              Fix all errors before importing. Rows with errors cannot be selected.
            </p>
          )}
        </>
      )}

      {/* Diff Viewer Dialog */}
      <DiffViewerDialog
        open={diffDialogOpen}
        onOpenChange={setDiffDialogOpen}
        duplicateInfo={selectedDiff}
      />
    </div>
  )
}
