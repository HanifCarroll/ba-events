import { useCallback } from 'react'
import { Download, Upload, FileText, X, Loader2, Zap, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ImportSource } from '@/hooks/useImportWizard'

const CSV_HEADERS = [
  'name', 'starts_at', 'ends_at', 'venue_name', 'categories', 'vibes',
  'price', 'is_free', 'min_age', 'link', 'ticket_url', 'description', 'status',
]

const TEMPLATE_ROW = [
  'Example Techno Night', '2025-01-15T22:00:00', '2025-01-16T06:00:00',
  'Club XYZ', 'techno,electronic', 'underground,high-energy', '5000',
  'false', '18', 'https://example.com', 'https://tickets.example.com',
  'An underground techno party', 'scheduled',
]

interface ConfigureStepProps {
  source: ImportSource
  startDate: string
  endDate: string
  csvFileName: string | null
  isFetching: boolean
  onStartDateChange: (date: string) => void
  onEndDateChange: (date: string) => void
  onFetchPassline: () => void
  onFetchEventbrite: () => void
  onCSVFile: (file: File) => void
  onClearCSV: () => void
}

export function ConfigureStep({
  source,
  startDate,
  endDate,
  csvFileName,
  isFetching,
  onStartDateChange,
  onEndDateChange,
  onFetchPassline,
  onFetchEventbrite,
  onCSVFile,
  onClearCSV,
}: ConfigureStepProps) {
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

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onCSVFile(file)
    }
    e.target.value = ''
  }, [onCSVFile])

  if (source === 'passline') {
    return (
      <div className="space-y-6 max-w-md mx-auto">
        <div className="text-center space-y-2">
          <h2 className="font-display text-xl font-semibold text-foreground">
            Configure Date Range
          </h2>
          <p className="text-muted-foreground">
            Select the date range to fetch events from Passline
          </p>
        </div>

        <div className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start-date">From</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className="bg-background/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">To</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
                className="bg-background/50"
              />
            </div>
          </div>

          <Button
            onClick={onFetchPassline}
            disabled={isFetching}
            className="w-full bg-primary text-primary-foreground"
          >
            {isFetching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Fetching events...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Fetch Events
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Only events in Capital Federal (CABA) will be imported
        </p>
      </div>
    )
  }

  if (source === 'eventbrite') {
    return (
      <div className="space-y-6 max-w-md mx-auto">
        <div className="text-center space-y-2">
          <h2 className="font-display text-xl font-semibold text-foreground">
            Configure Date Range
          </h2>
          <p className="text-muted-foreground">
            Select the date range to fetch events from Eventbrite
          </p>
        </div>

        <div className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start-date">From</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className="bg-background/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">To</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
                className="bg-background/50"
              />
            </div>
          </div>

          <Button
            onClick={onFetchEventbrite}
            disabled={isFetching}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          >
            {isFetching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Fetching events...
              </>
            ) : (
              <>
                <Ticket className="h-4 w-4 mr-2" />
                Fetch Events
              </>
            )}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground text-center space-y-1">
          <p>Fetches events from Eventbrite Buenos Aires listing</p>
          <p>Descriptions are included • Prices require enrichment</p>
        </div>
      </div>
    )
  }

  // TODO: BA Tourism integration
  // if (source === 'ba-tourism') { ... }

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <div className="text-center space-y-2">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Upload CSV File
        </h2>
        <p className="text-muted-foreground">
          Upload a CSV file with your event data
        </p>
      </div>

      <div className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-4">
        <Button
          variant="outline"
          onClick={downloadTemplate}
          className="w-full border-border/50"
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
          <Button variant="outline" className="w-full border-border/50 pointer-events-none">
            <Upload className="h-4 w-4 mr-2" />
            Select CSV File
          </Button>
        </div>

        {csvFileName && (
          <div className="flex items-center justify-between px-3 py-2 bg-background/50 rounded-lg border border-border/30">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground">{csvFileName}</span>
            </div>
            <button
              onClick={onClearCSV}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground text-center space-y-1">
        <p>Required columns: <strong>name</strong>, <strong>starts_at</strong></p>
        <p>Download the template to see all available columns</p>
      </div>
    </div>
  )
}
