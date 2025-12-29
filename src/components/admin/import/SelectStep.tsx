import { CheckCircle2, HelpCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function VenueMatchIndicator({ event }: { event: PasslinePreviewEvent }) {
  const { matchType, confidence, venue } = event.venueMatch

  if (matchType === 'exact') {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <span className="text-sm">{venue?.name}</span>
      </div>
    )
  }

  if (matchType === 'fuzzy') {
    return (
      <div className="flex items-center gap-2">
        <HelpCircle className="h-4 w-4 text-yellow-500" />
        <span className="text-sm">
          {venue?.name}
          <span className="text-muted-foreground ml-1">
            ({Math.round(confidence * 100)}%)
          </span>
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <AlertCircle className="h-4 w-4 text-red-500" />
      <span className="text-sm text-muted-foreground">{event.passline.lugar}</span>
    </div>
  )
}

export function SelectStep({
  source,
  passlineEvents,
  csvRows,
  csvValidCount,
  csvErrorCount,
  csvAllValid,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onProceed,
}: SelectStepProps) {
  const isPassline = source === 'passline'
  const totalCount = isPassline ? passlineEvents.length : csvRows.length
  const canProceed = isPassline ? selectedIds.size > 0 : (csvAllValid && selectedIds.size > 0)

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
      <div className="bg-card/50 rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={selectedIds.size === (isPassline ? passlineEvents.length : csvValidCount)}
                  onCheckedChange={onToggleSelectAll}
                />
              </TableHead>
              {isPassline ? (
                <>
                  <TableHead>Event</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </>
              ) : (
                <>
                  <TableHead className="w-12">Row</TableHead>
                  <TableHead className="w-12">Status</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Errors</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPassline ? (
              passlineEvents.map((event) => (
                <TableRow
                  key={event.passline.id}
                  className={selectedIds.has(event.passline.id) ? 'bg-primary/5' : ''}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(event.passline.id)}
                      onCheckedChange={() => onToggleSelect(event.passline.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium line-clamp-1">
                        {event.passline.nombre}
                      </span>
                      {event.passline.artistas && (
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {event.passline.artistas}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDate(event.transformed.starts_at)}
                  </TableCell>
                  <TableCell>
                    <VenueMatchIndicator event={event} />
                  </TableCell>
                  <TableCell>
                    {(event.transformed.categories || []).map((cat) => (
                      <Badge key={cat} variant="secondary" className="mr-1 text-xs">
                        {cat}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    {event.transformed.is_free ? (
                      <Badge variant="outline" className="text-green-500 border-green-500/30">
                        Free
                      </Badge>
                    ) : event.transformed.price ? (
                      <span className="text-sm">
                        ${event.transformed.price.toLocaleString('es-AR')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              csvRows.map((row, index) => {
                const rowId = `csv-${index}`
                const hasErrors = row.errors.length > 0

                return (
                  <TableRow
                    key={row.rowNumber}
                    className={`${hasErrors ? 'bg-destructive/5' : ''} ${
                      selectedIds.has(rowId) ? 'bg-primary/5' : ''
                    }`}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(rowId)}
                        onCheckedChange={() => onToggleSelect(rowId)}
                        disabled={hasErrors}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
                    <TableCell>
                      {hasErrors ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {row.data.name || '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.data.starts_at || '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.data.venue_name || '-'}
                    </TableCell>
                    <TableCell>
                      {row.errors.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {row.errors.map((error, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="text-xs border-destructive/30 text-destructive"
                            >
                              {error}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {!isPassline && !csvAllValid && (
        <p className="text-sm text-muted-foreground text-center">
          Fix all errors before importing. Rows with errors cannot be selected.
        </p>
      )}
    </div>
  )
}
