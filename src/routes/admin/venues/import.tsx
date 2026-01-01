import { createFileRoute, useRouter, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Upload, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { VenueCSVUploader } from './-components/VenueCSVUploader'
import { bulkCreateVenuesAction } from '@/features/venues'
import type { VenueInsert } from '@/shared/lib/types'

export const Route = createFileRoute('/admin/venues/import')({
  component: ImportVenuesPage,
})

function ImportVenuesPage() {
  const router = useRouter()
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: boolean; count: number } | null>(null)

  async function handleImport(venues: VenueInsert[]) {
    setIsImporting(true)
    setImportResult(null)

    try {
      const result = await bulkCreateVenuesAction({ data: venues })
      setImportResult(result)

      // Redirect to venues list after short delay
      setTimeout(() => {
        router.navigate({ to: '/admin/venues' })
      }, 2000)
    } catch (error) {
      console.error('Import failed:', error)
      setImportResult({ success: false, count: 0 })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
        >
          <Link to="/admin/venues">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Upload className="h-6 w-6 text-primary" />
            Import Venues
          </h1>
          <p className="text-muted-foreground mt-1">
            Bulk import venues from a CSV file
          </p>
        </div>
      </div>

      <div className="deco-line w-24" />

      {/* Success message */}
      {importResult?.success && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          <div>
            <p className="font-medium text-green-400">
              Successfully imported {importResult.count} venues!
            </p>
            <p className="text-sm text-green-400/80">
              Redirecting to venues list...
            </p>
          </div>
        </div>
      )}

      {/* Error message */}
      {importResult && !importResult.success && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="font-medium text-destructive">
            Import failed. Please try again.
          </p>
        </div>
      )}

      {/* CSV Uploader */}
      <div className="bg-card/50 rounded-xl border border-border/50 p-6">
        <VenueCSVUploader
          onImport={handleImport}
          isImporting={isImporting}
        />
      </div>
    </div>
  )
}
