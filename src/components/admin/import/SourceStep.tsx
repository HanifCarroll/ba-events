import { Zap, FileSpreadsheet, ArrowRight } from 'lucide-react'
import type { ImportSource } from '@/hooks/useImportWizard'

interface SourceStepProps {
  onSelectSource: (source: ImportSource) => void
}

export function SourceStep({ onSelectSource }: SourceStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Choose Import Source
        </h2>
        <p className="text-muted-foreground">
          Select where you want to import events from
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 max-w-2xl mx-auto">
        {/* Passline Card */}
        <button
          onClick={() => onSelectSource('passline')}
          className="group relative bg-card/50 hover:bg-card/80 border border-border/50 hover:border-primary/50 rounded-xl p-6 text-left transition-all duration-200"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-foreground mb-1">
                Passline
              </h3>
              <p className="text-sm text-muted-foreground">
                Fetch events directly from Passline API. Only events in Buenos Aires (CABA) will be imported.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                Automatic
              </span>
              <span className="text-xs bg-muted/50 text-muted-foreground px-2 py-1 rounded-full">
                CABA only
              </span>
            </div>
          </div>
        </button>

        {/* CSV Card */}
        <button
          onClick={() => onSelectSource('csv')}
          className="group relative bg-card/50 hover:bg-card/80 border border-border/50 hover:border-primary/50 rounded-xl p-6 text-left transition-all duration-200"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-4">
            <div className="h-12 w-12 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <FileSpreadsheet className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-foreground mb-1">
                CSV Upload
              </h3>
              <p className="text-sm text-muted-foreground">
                Upload a CSV file with event data. Download a template to see the required format.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded-full">
                Manual
              </span>
              <span className="text-xs bg-muted/50 text-muted-foreground px-2 py-1 rounded-full">
                Any location
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}
