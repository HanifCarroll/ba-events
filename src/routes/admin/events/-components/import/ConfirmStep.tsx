import { Loader2, Download, CheckCircle2, Zap, FileSpreadsheet, Ticket, Landmark, Users, Sparkles, AlertTriangle, MapPin, FileText } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import type { ImportSource, BatchProgress } from '@/features/import'

export interface VenueStats {
  matched: number
  unmatched: number
  toCreate: number
}

export interface DataQuality {
  withDescription: number
  withoutDescription: number
}

interface ConfirmStepProps {
  source: ImportSource
  selectedCount: number
  isImporting: boolean
  importProgress: { current: number; total: number } | null
  batchProgress: BatchProgress | null
  venueStats: VenueStats
  dataQuality: DataQuality
  onImport: () => void
}

const SOURCE_CONFIG: Record<ImportSource, {
  name: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  bgColor: string
  iconColor: string
}> = {
  passline: {
    name: 'Passline Import',
    label: 'Passline API',
    icon: Zap,
    bgColor: 'bg-primary/10',
    iconColor: 'text-primary',
  },
  eventbrite: {
    name: 'Eventbrite Import',
    label: 'Eventbrite',
    icon: Ticket,
    bgColor: 'bg-orange-500/10',
    iconColor: 'text-orange-500',
  },
  'ba-tourism': {
    name: 'BA Tourism Import',
    label: 'BA Tourism',
    icon: Landmark,
    bgColor: 'bg-sky-500/10',
    iconColor: 'text-sky-500',
  },
  meetup: {
    name: 'Meetup Import',
    label: 'Meetup',
    icon: Users,
    bgColor: 'bg-red-500/10',
    iconColor: 'text-red-500',
  },
  luma: {
    name: 'Luma Import',
    label: 'Luma',
    icon: Sparkles,
    bgColor: 'bg-violet-500/10',
    iconColor: 'text-violet-500',
  },
  csv: {
    name: 'CSV Import',
    label: 'CSV File',
    icon: FileSpreadsheet,
    bgColor: 'bg-emerald-500/10',
    iconColor: 'text-emerald-500',
  },
}

export function ConfirmStep({
  source,
  selectedCount,
  isImporting,
  importProgress,
  batchProgress,
  venueStats,
  dataQuality,
  onImport,
}: ConfirmStepProps) {
  const config = SOURCE_CONFIG[source]
  const Icon = config.icon

  const totalVenues = venueStats.matched + venueStats.unmatched
  const hasVenueData = totalVenues > 0
  const hasUnmatchedVenues = venueStats.unmatched > 0
  const missingDescriptions = dataQuality.withoutDescription > 0

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <div className="text-center space-y-2">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Confirm Import
        </h2>
        <p className="text-muted-foreground">
          Review your import and confirm to proceed
        </p>
      </div>

      <div className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-6">
        {/* Source indicator */}
        <div className="flex items-center gap-3 pb-4 border-b border-border/30">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${config.bgColor}`}>
            <Icon className={`h-5 w-5 ${config.iconColor}`} />
          </div>
          <div>
            <p className="font-medium text-foreground">
              {config.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {selectedCount} event{selectedCount !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Events to import</span>
            <span className="font-medium text-foreground">{selectedCount}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Source</span>
            <span className="font-medium text-foreground">
              {config.label}
            </span>
          </div>
        </div>

        {/* Pre-import Summary: Venue & Data Quality */}
        {(hasVenueData || dataQuality.withDescription > 0 || dataQuality.withoutDescription > 0) && (
          <div className="border-t border-border/30 pt-4 space-y-4">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              Pre-Import Summary
            </h4>

            {/* Venue Stats */}
            {hasVenueData && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>Venues</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center justify-between bg-green-500/10 rounded-lg px-3 py-2">
                    <span className="text-muted-foreground">Matched</span>
                    <span className="font-medium text-green-500">{venueStats.matched}</span>
                  </div>
                  {venueStats.toCreate > 0 && (
                    <div className="flex items-center justify-between bg-blue-500/10 rounded-lg px-3 py-2">
                      <span className="text-muted-foreground">New</span>
                      <span className="font-medium text-blue-500">{venueStats.toCreate}</span>
                    </div>
                  )}
                  {hasUnmatchedVenues && venueStats.toCreate === 0 && (
                    <div className="flex items-center justify-between bg-amber-500/10 rounded-lg px-3 py-2">
                      <span className="text-muted-foreground">Unmatched</span>
                      <span className="font-medium text-amber-500">{venueStats.unmatched}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Data Quality */}
            {(dataQuality.withDescription > 0 || dataQuality.withoutDescription > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Descriptions</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center justify-between bg-green-500/10 rounded-lg px-3 py-2">
                    <span className="text-muted-foreground">With</span>
                    <span className="font-medium text-green-500">{dataQuality.withDescription}</span>
                  </div>
                  <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                    missingDescriptions ? 'bg-amber-500/10' : 'bg-muted/50'
                  }`}>
                    <span className="text-muted-foreground">Without</span>
                    <span className={`font-medium ${missingDescriptions ? 'text-amber-500' : 'text-muted-foreground'}`}>
                      {dataQuality.withoutDescription}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Warning badges */}
            <div className="flex flex-wrap gap-2">
              {hasUnmatchedVenues && venueStats.toCreate === 0 && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {venueStats.unmatched} venue{venueStats.unmatched !== 1 ? 's' : ''} without match
                </Badge>
              )}
              {missingDescriptions && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {dataQuality.withoutDescription} event{dataQuality.withoutDescription !== 1 ? 's' : ''} missing description
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Progress bar */}
        {(importProgress || batchProgress) && (
          <div className="space-y-2">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{
                  width: `${batchProgress
                    ? (batchProgress.overallCurrent / batchProgress.overallTotal) * 100
                    : importProgress
                      ? (importProgress.current / importProgress.total) * 100
                      : 0}%`
                }}
              />
            </div>
            {batchProgress ? (
              <div className="text-xs text-muted-foreground text-center space-y-0.5">
                <p className="font-medium">
                  Batch {batchProgress.currentBatch} of {batchProgress.totalBatches}
                </p>
                <p>
                  {batchProgress.overallCurrent} of {batchProgress.overallTotal} events
                  {batchProgress.phase && ` (${batchProgress.phase})`}
                </p>
              </div>
            ) : importProgress && (
              <p className="text-xs text-muted-foreground text-center">
                {importProgress.current} of {importProgress.total} events imported
              </p>
            )}
          </div>
        )}

        {/* Import button */}
        <Button
          onClick={onImport}
          disabled={isImporting || selectedCount === 0}
          className="w-full bg-green-600 hover:bg-green-700 text-white"
        >
          {isImporting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {batchProgress
                ? `Batch ${batchProgress.currentBatch}/${batchProgress.totalBatches} - ${batchProgress.batchCurrent}/${batchProgress.batchTotal}`
                : importProgress
                  ? `Importing ${importProgress.current}/${importProgress.total}...`
                  : 'Importing...'}
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Import {selectedCount} Event{selectedCount !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </div>

      {/* Success indicator would appear here after import */}
      {isImporting && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span>You'll be redirected after import completes</span>
        </div>
      )}
    </div>
  )
}
