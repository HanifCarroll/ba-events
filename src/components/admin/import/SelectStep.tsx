import { useMemo } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, getPasslineColumns, getCSVColumns } from '@/components/data-table'
import type { ParsedCSVRowWithId, PasslineEventWithId } from '@/components/data-table'
import type { PasslinePreviewEvent } from '@/lib/admin'
import type { ImportSource } from '@/hooks/useImportWizard'

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
  csvRows: ParsedCSVRow[]
  csvValidCount: number
  csvErrorCount: number
  csvAllValid: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onProceed: () => void
}

export function SelectStep({
  source,
  passlineEvents,
  csvRows,
  csvErrorCount,
  csvAllValid,
  selectedIds,
  onToggleSelect,
  onProceed,
}: SelectStepProps) {
  const isPassline = source === 'passline'
  const totalCount = isPassline ? passlineEvents.length : csvRows.length
  const canProceed = isPassline ? selectedIds.size > 0 : (csvAllValid && selectedIds.size > 0)

  // Transform data to include id field for DataTable compatibility
  const passlineData = useMemo((): PasslineEventWithId[] => {
    return passlineEvents.map((event) => ({
      ...event,
      id: event.passline.id,
    }))
  }, [passlineEvents])

  const csvData = useMemo((): ParsedCSVRowWithId[] => {
    return csvRows.map((row, index) => ({
      ...row,
      id: `csv-${index}`,
    }))
  }, [csvRows])

  // Get column definitions
  const passlineColumns = useMemo(() => getPasslineColumns(), [])
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

      {/* Summary & Proceed */}
      <div className="flex items-center justify-between px-4 py-3 bg-card/50 rounded-xl border border-border/50">
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="border-primary/30 text-primary">
            {selectedIds.size} selected
          </Badge>
          <span className="text-sm text-muted-foreground">
            of {totalCount} events
          </span>
          {!isPassline && csvErrorCount > 0 && (
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
