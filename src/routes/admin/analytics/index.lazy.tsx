import { createLazyFileRoute } from '@tanstack/react-router'
import { BarChart3, Users, Bookmark, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import {
  useActiveUsers,
  usePageviews,
  useTopEvents,
  useSearchTerms,
  useEventEngagement,
} from '@/features/analytics/hooks/useAnalytics'
import type { DateRange } from '@/features/analytics/types'
import { PageviewsChart } from './-components/PageviewsChart'
import { TopEventsTable } from './-components/TopEventsTable'
import { SearchTermsTable } from './-components/SearchTermsTable'

export const Route = createLazyFileRoute('/admin/analytics/')({
  component: AnalyticsDashboard,
})

function AnalyticsDashboard() {
  const searchParams = Route.useSearch()
  const navigate = Route.useNavigate()
  const range: DateRange = (searchParams.range as DateRange) || '7d'

  const handleRangeChange = (newRange: string) => {
    navigate({ search: { range: newRange as DateRange } })
  }

  // Fetch all analytics data
  const { data: activeUsers, isLoading: loadingUsers } = useActiveUsers(range)
  const { data: pageviews, isLoading: loadingPageviews } = usePageviews(range)
  const { data: topEvents, isLoading: loadingTopEvents } = useTopEvents(range)
  const { data: searchTerms, isLoading: loadingSearchTerms } = useSearchTerms(range)
  const { data: engagement, isLoading: loadingEngagement } = useEventEngagement(range)

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-foreground flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-primary" />
            Analytics
          </h1>
          <p className="text-muted-foreground mt-1">Track user engagement and content performance</p>
          <div className="deco-line w-24 mt-4" />
        </div>

        <Select value={range} onValueChange={handleRangeChange}>
          <SelectTrigger className="w-[140px] bg-card/50 border-border/50">
            <SelectValue placeholder="Select range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <StatCard
          title="Daily Active Users"
          value={activeUsers?.dau ?? 0}
          trend={activeUsers?.dauTrend}
          icon={Users}
          loading={loadingUsers}
          color="text-blue-400"
          bgColor="bg-blue-500/10"
        />
        <StatCard
          title="Weekly Active Users"
          value={activeUsers?.wau ?? 0}
          trend={activeUsers?.wauTrend}
          icon={Users}
          loading={loadingUsers}
          color="text-primary"
          bgColor="bg-primary/10"
        />
        <StatCard
          title="Events Saved"
          value={engagement?.totalSaves ?? 0}
          trend={engagement?.savesTrend}
          icon={Bookmark}
          loading={loadingEngagement}
          color="text-green-400"
          bgColor="bg-green-500/10"
        />
        <StatCard
          title="Link Clicks"
          value={engagement?.totalClicks ?? 0}
          trend={engagement?.clicksTrend}
          icon={ExternalLink}
          loading={loadingEngagement}
          color="text-accent"
          bgColor="bg-accent/10"
        />
      </div>

      {/* Pageviews Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Pageviews</CardTitle>
        </CardHeader>
        <CardContent>
          <PageviewsChart data={pageviews ?? []} loading={loadingPageviews} />
        </CardContent>
      </Card>

      {/* Top Events & Search Terms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Top Events</CardTitle>
          </CardHeader>
          <CardContent>
            <TopEventsTable data={topEvents ?? []} loading={loadingTopEvents} />
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Popular Searches</CardTitle>
          </CardHeader>
          <CardContent>
            <SearchTermsTable data={searchTerms ?? []} loading={loadingSearchTerms} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

interface StatCardProps {
  title: string
  value: number
  trend?: number
  icon: React.ComponentType<{ className?: string }>
  loading: boolean
  color: string
  bgColor: string
}

function StatCard({ title, value, trend, icon: Icon, loading, color, bgColor }: StatCardProps) {
  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`p-2 rounded-lg ${bgColor}`}>
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-9 w-16 bg-muted/50 rounded animate-pulse" />
        ) : (
          <>
            <div className="text-3xl font-display font-semibold text-foreground">
              {value.toLocaleString()}
            </div>
            {trend !== undefined && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {trend >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                <span>{trend >= 0 ? '+' : ''}{trend}% vs prev period</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
