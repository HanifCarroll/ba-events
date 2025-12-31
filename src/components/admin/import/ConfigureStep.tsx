import { useCallback } from 'react'
import { Download, Upload, FileText, X, Loader2, Zap, Ticket, Landmark, Users, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ImportSource } from '@/hooks/useImportWizard'
import { getSourceMetadata, type DataStatus } from '@/lib/source-metadata'

const CSV_HEADERS = [
  'name', 'starts_at', 'ends_at', 'venue_name', 'categories',
  'price', 'is_free', 'min_age', 'link', 'ticket_url', 'description', 'status',
]

const TEMPLATE_ROW = [
  'Example Techno Night', '2025-01-15T22:00:00', '2025-01-16T06:00:00',
  'Club XYZ', 'music', '5000',
  'false', '18', 'https://example.com', 'https://tickets.example.com',
  'An underground techno party', 'scheduled',
]

function DataStatusIcon({ status }: { status: DataStatus }) {
  if (status === 'included') {
    return <CheckCircle2 className="h-4 w-4 text-green-500" />
  }
  if (status === 'requires_enrichment') {
    return <AlertCircle className="h-4 w-4 text-amber-500" />
  }
  return <X className="h-4 w-4 text-muted-foreground" />
}

function DataExpectationsPanel({ source }: { source: ImportSource }) {
  const metadata = getSourceMetadata(source)

  const items = [
    { label: 'Description', status: metadata.dataGaps.description },
    { label: 'Venue', status: metadata.dataGaps.venue },
    { label: 'Price', status: metadata.dataGaps.price },
    { label: 'Categories', status: metadata.dataGaps.categories },
  ]

  return (
    <div className="bg-muted/30 rounded-lg border border-border/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Info className="h-4 w-4 text-muted-foreground" />
        Data Availability
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(({ label, status }) => (
          <div key={label} className="flex items-center gap-2 text-sm">
            <DataStatusIcon status={status} />
            <span className={status === 'included' ? 'text-foreground' : 'text-muted-foreground'}>
              {label}
            </span>
          </div>
        ))}
      </div>
      {metadata.note && (
        <p className="text-xs text-muted-foreground pt-1 border-t border-border/30">
          {metadata.note}
        </p>
      )}
    </div>
  )
}

interface ConfigureStepProps {
  source: ImportSource
  startDate: string
  endDate: string
  csvFileName: string | null
  isFetching: boolean
  meetupFetchProgress?: {
    currentBatch: number
    totalBatches: number
    eventsFound: number
  } | null
  onStartDateChange: (date: string) => void
  onEndDateChange: (date: string) => void
  onFetchPassline: () => void
  onFetchEventbrite: () => void
  onFetchBaTourism: () => void
  onFetchMeetup: () => void
  onCSVFile: (file: File) => void
  onClearCSV: () => void
}

export function ConfigureStep({
  source,
  startDate,
  endDate,
  csvFileName,
  isFetching,
  meetupFetchProgress,
  onStartDateChange,
  onEndDateChange,
  onFetchPassline,
  onFetchEventbrite,
  onFetchBaTourism,
  onFetchMeetup,
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

          <DataExpectationsPanel source="passline" />
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

          <DataExpectationsPanel source="eventbrite" />
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Fetches events from Eventbrite Buenos Aires listing
        </p>
      </div>
    )
  }

  if (source === 'ba-tourism') {
    return (
      <div className="space-y-6 max-w-md mx-auto">
        <div className="text-center space-y-2">
          <h2 className="font-display text-xl font-semibold text-foreground">
            Fetch Weekly Events
          </h2>
          <p className="text-muted-foreground">
            Import this week's events from Buenos Aires Tourism
          </p>
        </div>

        <div className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-4">
          <div className="text-center text-sm text-muted-foreground">
            <p>The BA Tourism website publishes a weekly list of events.</p>
            <p className="mt-2">Click below to fetch this week's events.</p>
          </div>

          <Button
            onClick={onFetchBaTourism}
            disabled={isFetching}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white"
          >
            {isFetching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Fetching events...
              </>
            ) : (
              <>
                <Landmark className="h-4 w-4 mr-2" />
                Fetch Weekly Events
              </>
            )}
          </Button>

          <DataExpectationsPanel source="ba-tourism" />
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Source: turismo.buenosaires.gob.ar
        </p>
      </div>
    )
  }

  if (source === 'meetup') {
    return (
      <div className="space-y-6 max-w-md mx-auto">
        <div className="text-center space-y-2">
          <h2 className="font-display text-xl font-semibold text-foreground">
            Configure Date Range
          </h2>
          <p className="text-muted-foreground">
            Select the date range to fetch events from Meetup
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
            onClick={onFetchMeetup}
            disabled={isFetching}
            className="w-full bg-red-500 hover:bg-red-600 text-white"
          >
            {isFetching && meetupFetchProgress ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Batch {meetupFetchProgress.currentBatch}/{meetupFetchProgress.totalBatches}
                {meetupFetchProgress.eventsFound > 0 && ` (${meetupFetchProgress.eventsFound} events)`}
              </>
            ) : isFetching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Fetching events...
              </>
            ) : (
              <>
                <Users className="h-4 w-4 mr-2" />
                Fetch Events
              </>
            )}
          </Button>

          <DataExpectationsPanel source="meetup" />
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Recurring events are expanded to 4 weeks of occurrences
        </p>
      </div>
    )
  }

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
