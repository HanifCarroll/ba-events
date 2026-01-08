import { createFileRoute } from '@tanstack/react-router'
import {
  Bot,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Calendar,
  MapPin,
  RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import {
  getLatestScrapeRunsAction,
  getScrapeStatsAction,
  getVenueReviewCountAction,
} from '@/features/import'
import type { ScrapeRun, ScrapeRunSource, ScrapeRunStatus } from '@/shared/lib/types'

export const Route = createFileRoute('/admin/scraping/')({
  loader: async () => {
    const [latestRuns, stats, venueReviewCount] = await Promise.all([
      getLatestScrapeRunsAction(),
      getScrapeStatsAction(),
      getVenueReviewCountAction(),
    ])
    return { latestRuns, stats, venueReviewCount }
  },
  component: ScrapingDashboard,
})

const SOURCE_INFO: Record<ScrapeRunSource, { name: string; color: string }> = {
  passline: { name: 'Passline', color: 'bg-blue-500' },
  eventbrite: { name: 'Eventbrite', color: 'bg-orange-500' },
  'ba-tourism': { name: 'BA Tourism', color: 'bg-green-500' },
  meetup: { name: 'Meetup', color: 'bg-red-500' },
  luma: { name: 'Luma', color: 'bg-purple-500' },
  all: { name: 'All Sources', color: 'bg-primary' },
}

function getStatusBadge(status: ScrapeRunStatus) {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/30">
          <CheckCircle className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      )
    case 'running':
      return (
        <Badge variant="secondary" className="bg-blue-500/20 text-blue-400 border-blue-500/30">
          <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
          Running
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="destructive" className="bg-red-500/20 text-red-400 border-red-500/30">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      )
    case 'partial':
      return (
        <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Partial
        </Badge>
      )
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function SourceCard({ source, run }: { source: ScrapeRunSource; run: ScrapeRun | null }) {
  const info = SOURCE_INFO[source]

  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${info.color}`} />
          <CardTitle className="text-sm font-medium text-foreground">{info.name}</CardTitle>
        </div>
        {run && getStatusBadge(run.status)}
      </CardHeader>
      <CardContent>
        {run ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Last run: {formatRelativeTime(run.started_at)}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Inserted</p>
                <p className="text-lg font-semibold text-green-400">+{run.events_inserted}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Updated</p>
                <p className="text-lg font-semibold text-blue-400">{run.events_updated}</p>
              </div>
            </div>
            {run.venues_auto_created > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {run.venues_auto_created} venue{run.venues_auto_created > 1 ? 's' : ''} created
              </div>
            )}
            {run.error_message && (
              <p className="text-xs text-red-400 truncate" title={run.error_message}>
                {run.error_message}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No runs yet</p>
        )}
      </CardContent>
    </Card>
  )
}

function ScrapingDashboard() {
  const { latestRuns, stats, venueReviewCount } = Route.useLoaderData()

  const sources: ScrapeRunSource[] = ['passline', 'eventbrite', 'ba-tourism', 'meetup', 'luma']

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in-up p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Automated Scraping
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor daily scraping jobs and venue review queue
          </p>
        </div>
        <Button asChild variant="outline" className="border-primary/30 text-primary">
          <a
            href="https://cloud.trigger.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            Trigger.dev Dashboard
          </a>
        </Button>
      </div>

      <div className="deco-line w-24" />

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Last 7 Days
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-display font-semibold text-foreground">
              {stats.totalRuns}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Total scrape runs</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Events Imported
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-display font-semibold text-green-400">
              +{stats.totalEventsInserted}
            </div>
            <p className="text-xs text-muted-foreground mt-1">New events this week</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Venues Created
            </CardTitle>
            <MapPin className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-display font-semibold text-accent">
              {stats.totalVenuesCreated}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Auto-created this week</p>
          </CardContent>
        </Card>

        <Card
          className={`bg-card/50 border-border/50 ${
            venueReviewCount > 0 ? 'border-yellow-500/50' : ''
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Review
            </CardTitle>
            <AlertTriangle
              className={`h-4 w-4 ${venueReviewCount > 0 ? 'text-yellow-400' : 'text-muted-foreground'}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-display font-semibold ${
                venueReviewCount > 0 ? 'text-yellow-400' : 'text-foreground'
              }`}
            >
              {venueReviewCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {venueReviewCount > 0 ? (
                <span className="text-yellow-400">
                  Review pending
                </span>
              ) : (
                'All venues settled'
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Last Orchestrator Run */}
      {latestRuns.all && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-medium text-foreground flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-primary" />
                Last Daily Scrape
              </CardTitle>
              {getStatusBadge(latestRuns.all.status)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {formatRelativeTime(latestRuns.all.started_at)}
              </span>
              {latestRuns.all.completed_at && (
                <span>
                  Duration:{' '}
                  {Math.round(
                    (new Date(latestRuns.all.completed_at).getTime() -
                      new Date(latestRuns.all.started_at).getTime()) /
                      1000
                  )}
                  s
                </span>
              )}
              <span className="text-green-400">+{latestRuns.all.events_inserted} events</span>
              <span className="text-blue-400">{latestRuns.all.events_updated} updated</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Source Cards */}
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground mb-4">
          Source Status
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sources.map((source) => (
            <SourceCard
              key={source}
              source={source}
              run={latestRuns[source] ?? null}
            />
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" className="text-muted-foreground hover:text-foreground" disabled>
          View All Runs (coming soon)
        </Button>
        {venueReviewCount > 0 && (
          <Button className="bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30" disabled>
            Review {venueReviewCount} Venues (coming soon)
          </Button>
        )}
      </div>
    </div>
  )
}
