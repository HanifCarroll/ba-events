import { createFileRoute, Link } from '@tanstack/react-router'
import { Calendar, MapPin, Plus, Clock, CheckCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Button } from '@/shared/ui/button'
import { getAdminStats } from '@/features/events'
import * as m from '@/paraglide/messages'

export const Route = createFileRoute('/admin/')({
  loader: async () => {
    return getAdminStats()
  },
  component: AdminDashboard,
})

function AdminDashboard() {
  const stats = Route.useLoaderData()

  const statCards = [
    {
      title: m.admin_total_events(),
      value: stats.eventCount,
      icon: Calendar,
      description: m.admin_events_in_db(),
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: m.admin_upcoming_events(),
      value: stats.upcomingCount,
      icon: Clock,
      description: m.admin_starting_future(),
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: m.admin_scheduled(),
      value: stats.scheduledCount,
      icon: CheckCircle,
      description: m.admin_active_confirmed(),
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
    },
    {
      title: m.admin_venues(),
      value: stats.venueCount,
      icon: MapPin,
      description: m.admin_registered_venues(),
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in-up">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">{m.admin_dashboard()}</h1>
        <p className="text-muted-foreground mt-1">{m.admin_dashboard_subtitle()}</p>
        <div className="deco-line w-24 mt-4" />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title} className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-display font-semibold text-foreground">
                  {stat.value}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Add Event */}
        <Card className="bg-card/50 border-border/50 group hover:border-primary/30 hover:glow-gold-subtle transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                <Calendar className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-display text-lg font-semibold text-foreground mb-1">
                  {m.admin_add_new_event()}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {m.admin_add_event_desc()}
                </p>
                <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Link to="/admin/events/new">
                    <Plus className="h-4 w-4 mr-2" />
                    {m.admin_new_event()}
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Add Venue */}
        <Card className="bg-card/50 border-border/50 group hover:border-accent/30 transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-accent/10 text-accent group-hover:bg-accent/20 transition-colors">
                <MapPin className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-display text-lg font-semibold text-foreground mb-1">
                  {m.admin_add_new_venue()}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {m.admin_add_venue_desc()}
                </p>
                <Button asChild variant="outline" className="border-accent/50 text-accent hover:bg-accent/10 hover:border-accent">
                  <Link to="/admin/venues/new">
                    <Plus className="h-4 w-4 mr-2" />
                    {m.admin_new_venue()}
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
          <Link to="/admin/events">{m.admin_view_all_events()}</Link>
        </Button>
        <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
          <Link to="/admin/venues">{m.admin_view_all_venues()}</Link>
        </Button>
        <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
          <Link to="/">{m.admin_go_to_site()}</Link>
        </Button>
      </div>
    </div>
  )
}
