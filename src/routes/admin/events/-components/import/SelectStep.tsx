import { useMemo } from 'react'
import { ArrowRight, MapPin, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { DataTable, getPasslineColumns, getEventbriteColumns, getCSVColumns, getBaTourismColumns, getMeetupColumns } from '@/shared/ui/data-table'
import type { ParsedCSVRowWithId, PasslineEventWithId, EventbriteEventWithId, BaTourismEventWithId, MeetupEventWithId } from '@/shared/ui/data-table'
import type { PasslinePreviewEvent, EventbritePreviewEvent, BATourismPreviewEvent, MeetupPreviewEvent } from '@/features/import'
import type { ImportSource } from '@/features/import'

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
  csvRows: ParsedCSVRow[]
  csvValidCount: number
  csvErrorCount: number
  csvAllValid: boolean
  selectedIds: Set<string>
  unmatchedVenueCount: number
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onProceed: () => void
  onHandleVenues?: () => void
}

export function SelectStep({
  source,
  passlineEvents,
  eventbriteEvents,
  baTourismEvents,
  meetupEvents,
  csvRows,
  csvErrorCount,
  csvAllValid,
  selectedIds,
  unmatchedVenueCount,
  onToggleSelect,
  onProceed,
  onHandleVenues,
}: SelectStepProps) {
  const isPassline = source === 'passline'
  const isEventbrite = source === 'eventbrite'
  const isBaTourism = source === 'ba-tourism'
  const isMeetup = source === 'meetup'
  const totalCount = isPassline
    ? passlineEvents.length
    : isEventbrite
      ? eventbriteEvents.length
      : isBaTourism
        ? baTourismEvents.length
        : isMeetup
          ? meetupEvents.length
          : csvRows.length
  const canProceed = (isPassline || isEventbrite || isBaTourism || isMeetup)
    ? selectedIds.size > 0
    : (csvAllValid && selectedIds.size > 0)

  // Transform data to include id field for DataTable compatibility
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

  const csvData = useMemo((): ParsedCSVRowWithId[] => {
    return csvRows.map((row, index) => ({
      ...row,
      id: `csv-${index}`,
    }))
  }, [csvRows])

  // Get column definitions
  const passlineColumns = useMemo(() => getPasslineColumns(), [])
  const eventbriteColumns = useMemo(() => getEventbriteColumns(), [])
  const baTourismColumns = useMemo(() => getBaTourismColumns(), [])
  const meetupColumns = useMemo(() => getMeetupColumns(), [])
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

      {/* Venue Status Warning */}
      {unmatchedVenueCount > 0 && (isPassline || isEventbrite || isBaTourism || isMeetup) && (
        <div className="flex items-center justify-between px-4 py-3 bg-amber-500/10 rounded-xl border border-amber-500/30">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {unmatchedVenueCount} event{unmatchedVenueCount !== 1 ? 's' : ''} without venue match
              </p>
              <p className="text-xs text-muted-foreground">
                These events will be imported without a venue. You can create venues now or assign them later.
              </p>
            </div>
          </div>
          {onHandleVenues && (
            <Button
              variant="outline"
              size="sm"
              onClick={onHandleVenues}
              className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
            >
              <MapPin className="h-4 w-4 mr-2" />
              Handle Venues
            </Button>
          )}
        </div>
      )}

      {/* Already Imported Info - Meetup only */}
      {isMeetup && (() => {
        const alreadyImportedCount = meetupEvents.filter(e => e.alreadyImported).length
        if (alreadyImportedCount === 0) return null
        return (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/10 rounded-xl border border-blue-500/30">
            <RefreshCw className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {alreadyImportedCount} event{alreadyImportedCount !== 1 ? 's' : ''} already imported
              </p>
              <p className="text-xs text-muted-foreground">
                These events exist in your database and will be updated if re-imported.
              </p>
            </div>
          </div>
        )
      })()}

      {/* Summary & Proceed */}
      <div className="flex items-center justify-between px-4 py-3 bg-card/50 rounded-xl border border-border/50">
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="border-primary/30 text-primary">
            {selectedIds.size} selected
          </Badge>
          <span className="text-sm text-muted-foreground">
            of {totalCount} events
          </span>
          {!isPassline && !isEventbrite && !isBaTourism && !isMeetup && csvErrorCount > 0 && (
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
    </div>
  )
}
