import { useState, useCallback } from 'react'
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
import { NEIGHBORHOODS } from '@/lib/types'
import type { VenueInsert, Neighborhood } from '@/lib/types'

interface CSVRow {
  name?: string
  neighborhood?: string
  address?: string
  website?: string
  instagram_handle?: string
}

interface ParsedRow {
  rowNumber: number
  data: CSVRow
  errors: string[]
  venue?: VenueInsert
}

interface VenueCSVUploaderProps {
  onImport: (venues: VenueInsert[]) => Promise<void>
  isImporting: boolean
}

const CSV_HEADERS = [
  'name',
  'neighborhood',
  'address',
  'website',
  'instagram_handle',
]

const TEMPLATE_ROW = [
  'Club Example',
  'Palermo',
  'Av. Santa Fe 1234',
  'https://clubexample.com',
  '@clubexample',
]

export function VenueCSVUploader({ onImport, isImporting }: VenueCSVUploaderProps) {
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)

  const downloadTemplate = useCallback(() => {
    const csvContent = [
      CSV_HEADERS.join(','),
      TEMPLATE_ROW.join(','),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'venues_template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const validateRow = useCallback((row: CSVRow, rowNumber: number): ParsedRow => {
    const errors: string[] = []

    // Required fields
    if (!row.name?.trim()) {
      errors.push('Name is required')
    }

    // Validate neighborhood (required)
    let neighborhood: Neighborhood | undefined
    if (!row.neighborhood?.trim()) {
      errors.push('Neighborhood is required')
    } else {
      const found = NEIGHBORHOODS.find(n => n === row.neighborhood?.trim())
      if (!found) {
        errors.push(`Invalid neighborhood: "${row.neighborhood}"`)
      } else {
        neighborhood = found
      }
    }

    // Build venue if no errors
    let venue: VenueInsert | undefined
    if (errors.length === 0 && neighborhood) {
      venue = {
        name: row.name!.trim(),
        neighborhood,
        address: row.address?.trim() || null,
        website: row.website?.trim() || null,
        instagram_handle: row.instagram_handle?.trim() || null,
      }
    }

    return { rowNumber, data: row, errors, venue }
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)

    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.map((row, index) => validateRow(row, index + 2))
        setParsedRows(rows)
      },
      error: (error) => {
        console.error('CSV parsing error:', error)
        setParsedRows([])
      },
    })

    e.target.value = ''
  }, [validateRow])

  const clearFile = useCallback(() => {
    setParsedRows([])
    setFileName(null)
  }, [])

  const handleImport = useCallback(async () => {
    const venues = parsedRows
      .filter(row => row.venue)
      .map(row => row.venue!)

    await onImport(venues)
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
                    <TableHead className="text-muted-foreground font-medium">Neighborhood</TableHead>
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
                        {row.data.neighborhood || '—'}
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
                <>Import {validCount} Venues</>
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
          <p>Download the template, fill in your venues, then upload the CSV file.</p>
          <p className="text-sm mt-2">
            Required columns: <strong>name</strong>, <strong>neighborhood</strong>
          </p>
        </div>
      )}
    </div>
  )
}
