import { Zap, FileSpreadsheet, ArrowRight, Ticket, Landmark, Users, Sparkles } from 'lucide-react'
import type { ImportSource } from '@/features/import'

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 max-w-7xl mx-auto">
        {/* Passline Card */}
        <button
          onClick={() => onSelectSource('passline')}
          className="group relative bg-card/50 hover:bg-card/80 border border-border/50 hover:border-primary/50 rounded-xl p-6 text-left transition-all duration-200 h-full cursor-pointer"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight className="h-5 w-5 text-primary" />
          </div>
          <div className="flex flex-col h-full">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-foreground mb-1">
                Passline
              </h3>
              <p className="text-sm text-muted-foreground">
                Fetch events directly from Passline API. Only events in Buenos Aires (CABA) will be imported.
              </p>
            </div>
          </div>
        </button>

        {/* Eventbrite Card */}
        <button
          onClick={() => onSelectSource('eventbrite')}
          className="group relative bg-card/50 hover:bg-card/80 border border-border/50 hover:border-orange-500/50 rounded-xl p-6 text-left transition-all duration-200 h-full cursor-pointer"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight className="h-5 w-5 text-orange-500" />
          </div>
          <div className="flex flex-col h-full">
            <div className="h-12 w-12 rounded-lg bg-orange-500/10 flex items-center justify-center mb-4">
              <Ticket className="h-6 w-6 text-orange-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-foreground mb-1">
                Eventbrite
              </h3>
              <p className="text-sm text-muted-foreground">
                Fetch events from Eventbrite Buenos Aires listing. Includes descriptions and venue data.
              </p>
            </div>
          </div>
        </button>

        {/* BA Tourism Card */}
        <button
          onClick={() => onSelectSource('ba-tourism')}
          className="group relative bg-card/50 hover:bg-card/80 border border-border/50 hover:border-sky-500/50 rounded-xl p-6 text-left transition-all duration-200 h-full cursor-pointer"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight className="h-5 w-5 text-sky-500" />
          </div>
          <div className="flex flex-col h-full">
            <div className="h-12 w-12 rounded-lg bg-sky-500/10 flex items-center justify-center mb-4">
              <Landmark className="h-6 w-6 text-sky-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-foreground mb-1">
                BA Tourism
              </h3>
              <p className="text-sm text-muted-foreground">
                Fetch weekly events from the official Buenos Aires city tourism website.
              </p>
            </div>
          </div>
        </button>

        {/* Meetup Card */}
        <button
          onClick={() => onSelectSource('meetup')}
          className="group relative bg-card/50 hover:bg-card/80 border border-border/50 hover:border-red-500/50 rounded-xl p-6 text-left transition-all duration-200 h-full cursor-pointer"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex flex-col h-full">
            <div className="h-12 w-12 rounded-lg bg-red-500/10 flex items-center justify-center mb-4">
              <Users className="h-6 w-6 text-red-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-foreground mb-1">
                Meetup
              </h3>
              <p className="text-sm text-muted-foreground">
                Fetch events from Meetup Buenos Aires. Includes tech, social, and language exchange events.
              </p>
            </div>
          </div>
        </button>

        {/* Luma Card */}
        <button
          onClick={() => onSelectSource('luma')}
          className="group relative bg-card/50 hover:bg-card/80 border border-border/50 hover:border-violet-500/50 rounded-xl p-6 text-left transition-all duration-200 h-full cursor-pointer"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight className="h-5 w-5 text-violet-500" />
          </div>
          <div className="flex flex-col h-full">
            <div className="h-12 w-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4">
              <Sparkles className="h-6 w-6 text-violet-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-foreground mb-1">
                Luma
              </h3>
              <p className="text-sm text-muted-foreground">
                Fetch events from Luma Buenos Aires. Includes social gatherings and community events.
              </p>
            </div>
          </div>
        </button>

        {/* CSV Card */}
        <button
          onClick={() => onSelectSource('csv')}
          className="group relative bg-card/50 hover:bg-card/80 border border-border/50 hover:border-emerald-500/50 rounded-xl p-6 text-left transition-all duration-200 h-full cursor-pointer"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="flex flex-col h-full">
            <div className="h-12 w-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-4">
              <FileSpreadsheet className="h-6 w-6 text-emerald-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-foreground mb-1">
                CSV Upload
              </h3>
              <p className="text-sm text-muted-foreground">
                Upload a CSV file with event data. Download a template to see the required format.
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}
