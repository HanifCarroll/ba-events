import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PasslineScraper } from '@/components/admin/PasslineScraper'
import { getVenuesForSelect } from '@/lib/admin'

export const Route = createFileRoute('/admin/events/passline')({
  loader: async () => {
    return getVenuesForSelect()
  },
  component: PasslineImportPage,
})

function PasslineImportPage() {
  const venues = Route.useLoaderData()

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
          <Link to="/admin/events">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Import from Passline
          </h1>
          <p className="text-muted-foreground mt-1">
            Fetch and import events from Passline (Capital Federal only)
          </p>
        </div>
      </div>

      <div className="deco-line w-24" />

      {/* Scraper Component */}
      <PasslineScraper venues={venues} />
    </div>
  )
}
