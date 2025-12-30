import { Link } from '@tanstack/react-router'
import { CheckCircle2, ArrowRight, MapPin, FileText, Tags, Sparkles, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ImportSource } from '@/hooks/useImportWizard'
import { getSourceMetadata } from '@/lib/source-metadata'

export interface ImportResult {
  inserted: number
  updated: number
  withVenue: number
  withoutVenue: number
  withDescription: number
  withoutDescription: number
  withCategories: number
  withoutCategories: number
}

interface SummaryStepProps {
  source: ImportSource
  importResult: ImportResult
  autoEnrich: boolean
  onAutoEnrichChange: (value: boolean) => void
  onEnrichNow: () => void
  onImportMore: () => void
  isEnrichingBackground?: boolean
}

export function SummaryStep({
  source,
  importResult,
  autoEnrich,
  onAutoEnrichChange,
  onEnrichNow,
  onImportMore,
  isEnrichingBackground = false,
}: SummaryStepProps) {
  const metadata = getSourceMetadata(source)
  const total = importResult.inserted + importResult.updated

  // Determine what needs enrichment based on source
  const needsDescriptionEnrichment = metadata.dataGaps.description === 'requires_enrichment'
  const needsCategoriesEnrichment = metadata.dataGaps.categories === 'requires_enrichment'
  const canEnrich = (needsDescriptionEnrichment && importResult.withoutDescription > 0) ||
    (needsCategoriesEnrichment && importResult.withoutCategories > 0)

  return (
    <div className="space-y-6 max-w-md mx-auto">
      {/* Success Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-green-500/10 mx-auto">
          <CheckCircle2 className="h-8 w-8 text-green-500" />
        </div>
        <h2 className="font-display text-xl font-semibold text-foreground">
          Import Complete
        </h2>
        <p className="text-muted-foreground">
          Successfully imported {total} event{total !== 1 ? 's' : ''} from {metadata.name}
        </p>
      </div>

      {/* Import Stats */}
      <div className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 bg-green-500/10 rounded-lg">
            <p className="text-2xl font-bold text-green-600">{importResult.inserted}</p>
            <p className="text-xs text-muted-foreground">New Events</p>
          </div>
          <div className="text-center p-3 bg-blue-500/10 rounded-lg">
            <p className="text-2xl font-bold text-blue-600">{importResult.updated}</p>
            <p className="text-xs text-muted-foreground">Updated</p>
          </div>
        </div>
      </div>

      {/* Quality Summary */}
      <div className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-4">
        <h3 className="text-sm font-medium text-foreground">Data Quality</h3>

        <div className="space-y-3">
          {/* Venues */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>With Venue</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-green-600 border-green-500/30">
                {importResult.withVenue}
              </Badge>
              {importResult.withoutVenue > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                  {importResult.withoutVenue} missing
                </Badge>
              )}
            </div>
          </div>

          {/* Descriptions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>With Description</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-green-600 border-green-500/30">
                {importResult.withDescription}
              </Badge>
              {importResult.withoutDescription > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                  {importResult.withoutDescription} missing
                </Badge>
              )}
            </div>
          </div>

          {/* Categories */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Tags className="h-4 w-4 text-muted-foreground" />
              <span>With Categories</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-green-600 border-green-500/30">
                {importResult.withCategories}
              </Badge>
              {importResult.withoutCategories > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                  {importResult.withoutCategories} missing
                </Badge>
              )}
            </div>
          </div>
        </div>

        {metadata.note && (
          <p className="text-xs text-muted-foreground pt-2 border-t border-border/30">
            {metadata.note}
          </p>
        )}
      </div>

      {/* Auto-Enrich Option */}
      {canEnrich && (
        <div className="bg-primary/5 rounded-xl border border-primary/20 p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoEnrich}
              onChange={(e) => onAutoEnrichChange(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-primary/50 text-primary focus:ring-primary/50"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Enrich missing data automatically
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This will run in the background while you continue working
              </p>
            </div>
          </label>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        <Button
          asChild
          className="w-full bg-primary text-primary-foreground"
        >
          <Link to="/admin/events">
            Go to Events
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </Button>

        <div className="grid grid-cols-2 gap-3">
          {canEnrich && !isEnrichingBackground && (
            <Button
              variant="outline"
              onClick={onEnrichNow}
              className="border-primary/30 text-primary hover:bg-primary/10"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Enrich Now
            </Button>
          )}
          {isEnrichingBackground && (
            <Button
              variant="outline"
              disabled
              className="border-primary/30 text-primary"
            >
              <Sparkles className="h-4 w-4 mr-2 animate-pulse" />
              Enriching...
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onImportMore}
            className="border-border/50"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Import More
          </Button>
        </div>
      </div>
    </div>
  )
}
