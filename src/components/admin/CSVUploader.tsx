import { useState, useCallback, useMemo } from 'react'
import Papa from 'papaparse'
import { Upload, Download, FileText, AlertCircle, CheckCircle2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CATEGORIES, VIBES, EVENT_STATUSES } from '@/lib/types'
import type { EventInsert, Category, Vibe, EventStatus } from '@/lib/types'

interface CSVRow {
  name?: string
  starts_at?: string
  ends_at?: string
  venue_name?: string
  categories?: string
  vibes?: string
  price?: string
  is_free?: string
  min_age?: string
  link?: string
  ticket_url?: string
  description?: string
  status?: string
  is_all_day?: string
}

interface ParsedRow {
  rowNumber: number
  data: CSVRow
  errors: string[]
  event?: EventInsert
}

interface CSVUploaderProps {
  venues: { id: string; name: string; neighborhood: string | null }[]
  onImport: (events: EventInsert[]) => Promise<void>
  isImporting: boolean
}

const CSV_HEADERS = [
  'name',
  'starts_at',
  'ends_at',
  'venue_name',
  'categories',
  'vibes',
  'price',
  'is_free',
  'min_age',
  'link',
  'ticket_url',
  'description',
  'status',
]

const TEMPLATE_ROW = [
  'Example Techno Night',
  '2025-01-15T22:00:00',
  '2025-01-16T06:00:00',
  'Club XYZ',
  'techno,electronic',
  'underground,high-energy',
  '5000',
  'false',
  '18',
  'https://example.com',
  'https://tickets.example.com',
  'An underground techno party',
  'scheduled',
]

export function CSVUploader({ venues, onImport, isImporting }: CSVUploaderProps) {
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)

  // Create venue name to ID lookup
  const venueNameToId = useMemo(() => {
    const map = new Map<string, string>()
    venues.forEach(v => map.set(v.name.toLowerCase(), v.id))
    return map
  }, [venues])

  const downloadTemplate = useCallback(() => {
    const csvContent = [
      CSV_HEADERS.join(','),
      TEMPLATE_ROW.map(val => val.includes(',') ? `"${val}"` : val).join(','),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'events_template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const validateRow = useCallback((row: CSVRow, rowNumber: number): ParsedRow => {
    const errors: string[] = []

    // Required fields
    if (!row.name?.trim()) {
      errors.push('Name is required')
    }

    if (!row.starts_at?.trim()) {
      errors.push('Start date is required')
    } else {
      const startDate = new Date(row.starts_at)
      if (isNaN(startDate.getTime())) {
        errors.push('Invalid start date format')
      }
    }

    // Validate end date if provided
    if (row.ends_at?.trim()) {
      const endDate = new Date(row.ends_at)
      if (isNaN(endDate.getTime())) {
        errors.push('Invalid end date format')
      } else if (row.starts_at) {
        const startDate = new Date(row.starts_at)
        if (!isNaN(startDate.getTime()) && endDate <= startDate) {
          errors.push('End date must be after start date')
        }
      }
    }

    // Validate venue if provided
    let venueId: string | null = null
    if (row.venue_name?.trim()) {
      const foundId = venueNameToId.get(row.venue_name.trim().toLowerCase())
      if (!foundId) {
        errors.push(`Venue "${row.venue_name}" not found`)
      } else {
        venueId = foundId
      }
    }

    // Validate categories
    const categories: Category[] = []
    if (row.categories?.trim()) {
      const cats = row.categories.split(',').map(c => c.trim().toLowerCase())
      for (const cat of cats) {
        if (CATEGORIES.includes(cat as Category)) {
          categories.push(cat as Category)
        } else {
          errors.push(`Invalid category: "${cat}"`)
        }
      }
    }

    // Validate vibes
    const vibes: Vibe[] = []
    if (row.vibes?.trim()) {
      const vs = row.vibes.split(',').map(v => v.trim().toLowerCase())
      for (const vibe of vs) {
        if (VIBES.includes(vibe as Vibe)) {
          vibes.push(vibe as Vibe)
        } else {
          errors.push(`Invalid vibe: "${vibe}"`)
        }
      }
    }

    // Validate price
    let price: number | null = null
    if (row.price?.trim()) {
      const parsed = parseFloat(row.price)
      if (isNaN(parsed) || parsed < 0) {
        errors.push('Price must be a positive number')
      } else {
        price = parsed
      }
    }

    // Validate min_age
    let minAge: number | null = null
    if (row.min_age?.trim()) {
      const parsed = parseInt(row.min_age, 10)
      if (isNaN(parsed) || parsed < 0) {
        errors.push('Min age must be a positive integer')
      } else {
        minAge = parsed
      }
    }

    // Validate status
    let status: EventStatus = 'scheduled'
    if (row.status?.trim()) {
      const s = row.status.trim().toLowerCase()
      if (EVENT_STATUSES.includes(s as EventStatus)) {
        status = s as EventStatus
      } else {
        errors.push(`Invalid status: "${row.status}"`)
      }
    }

    // Parse booleans
    const isFree = row.is_free?.trim().toLowerCase() === 'true'
    const isAllDay = row.is_all_day?.trim().toLowerCase() === 'true'

    // Build event if no errors
    let event: EventInsert | undefined
    if (errors.length === 0) {
      event = {
        name: row.name!.trim(),
        starts_at: new Date(row.starts_at!).toISOString(),
        ends_at: row.ends_at?.trim() ? new Date(row.ends_at).toISOString() : null,
        venue_id: venueId,
        categories,
        vibes,
        price: isFree ? null : price,
        is_free: isFree,
        min_age: minAge,
        link: row.link?.trim() || null,
        ticket_url: row.ticket_url?.trim() || null,
        description: row.description?.trim() || null,
        status,
        is_all_day: isAllDay,
        source: 'csv_import',
      }
    }

    return { rowNumber, data: row, errors, event }
  }, [venueNameToId])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)

    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.map((row, index) => validateRow(row, index + 2)) // +2 for 1-indexed + header
        setParsedRows(rows)
      },
      error: (error) => {
        console.error('CSV parsing error:', error)
        setParsedRows([])
      },
    })

    // Reset input so same file can be selected again
    e.target.value = ''
  }, [validateRow])

  const clearFile = useCallback(() => {
    setParsedRows([])
    setFileName(null)
  }, [])

  const handleImport = useCallback(async () => {
    const events = parsedRows
      .filter(row => row.event)
      .map(row => row.event!)

    await onImport(events)
  }, [parsedRows, onImport])

  const validCount = parsedRows.filter(r => r.errors.length === 0).length
  const errorCount = parsedRows.filter(r => r.errors.length > 0).length
  const allValid = parsedRows.length > 0 && errorCount === 0

  return (
    <div className="space-y-6">
      {/* Template download and file upload */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Button
          variant="outline"
          onClick={downloadTemplate}
          className="border-border/50"
        >
          <Download className="h-4 w-4 mr-2" />
          Download Template
        </Button>

        <div className="relative">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <Button variant="outline" className="border-border/50 pointer-events-none">
            <Upload className="h-4 w-4 mr-2" />
            Select CSV File
          </Button>
        </div>

        {fileName && (
          <div className="flex items-center gap-2 px-3 py-2 bg-card/50 rounded-lg border border-border/50">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-foreground">{fileName}</span>
            <button
              onClick={clearFile}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Preview table */}
      {parsedRows.length > 0 && (
        <>
          {/* Summary */}
          <div className="flex items-center gap-4">
            <Badge
              variant="outline"
              className={allValid ? 'border-green-500/30 text-green-400' : 'border-border/50'}
            >
              {validCount} valid rows
            </Badge>
            {errorCount > 0 && (
              <Badge variant="outline" className="border-destructive/30 text-destructive">
                {errorCount} rows with errors
              </Badge>
            )}
          </div>

          {/* Table */}
          <div className="bg-card/50 rounded-xl border border-border/50 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="text-muted-foreground font-medium w-12">Row</TableHead>
                    <TableHead className="text-muted-foreground font-medium w-12">Status</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Name</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Start Date</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Venue</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Categories</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((row) => (
                    <TableRow
                      key={row.rowNumber}
                      className={`border-border/30 ${row.errors.length > 0 ? 'bg-destructive/5' : ''}`}
                    >
                      <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
                      <TableCell>
                        {row.errors.length === 0 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-400" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {row.data.name || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.data.starts_at || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.data.venue_name || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.data.categories || '—'}
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
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Import button */}
          <div className="flex justify-end">
            <Button
              onClick={handleImport}
              disabled={!allValid || isImporting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isImporting ? (
                <>Importing...</>
              ) : (
                <>Import {validCount} Events</>
              )}
            </Button>
          </div>

          {!allValid && (
            <p className="text-sm text-muted-foreground text-center">
              Fix all errors before importing. All rows must be valid.
            </p>
          )}
        </>
      )}

      {/* Instructions when no file */}
      {parsedRows.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Download the template, fill in your events, then upload the CSV file.</p>
          <p className="text-sm mt-2">
            Required columns: <strong>name</strong>, <strong>starts_at</strong>
          </p>
        </div>
      )}
    </div>
  )
}
