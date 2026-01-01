import { Loader2, Download, CheckCircle2, Zap, FileSpreadsheet, Ticket, Landmark, Users } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import type { ImportSource } from '@/features/import'

interface ConfirmStepProps {
  source: ImportSource
  selectedCount: number
  isImporting: boolean
  importProgress: { current: number; total: number } | null
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
  onImport,
}: ConfirmStepProps) {
  const config = SOURCE_CONFIG[source]
  const Icon = config.icon

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

        {/* Progress bar */}
        {importProgress && (
          <div className="space-y-2">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {importProgress.current} of {importProgress.total} events imported
            </p>
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
              {importProgress
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
