import { createFileRoute, Link } from '@tanstack/react-router'
import { Calendar, MapPin, Plus, Clock, CheckCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getAdminStats } from '@/lib/admin'

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
      title: 'Total Events',
      value: stats.eventCount,
      icon: Calendar,
      description: 'Events in database',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Upcoming Events',
      value: stats.upcomingCount,
      icon: Clock,
      description: 'Starting in the future',
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'Scheduled',
      value: stats.scheduledCount,
      icon: CheckCircle,
      description: 'Active & confirmed',
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Venues',
      value: stats.venueCount,
      icon: MapPin,
      description: 'Registered venues',
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in-up">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Manage your events and venues</p>
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
                  Add New Event
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create a new event with details, venue, and categories.
                </p>
                <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Link to="/admin/events/new">
                    <Plus className="h-4 w-4 mr-2" />
                    New Event
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
                  Add New Venue
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Register a new venue with location and contact info.
                </p>
                <Button asChild variant="outline" className="border-accent/50 text-accent hover:bg-accent/10 hover:border-accent">
                  <Link to="/admin/venues/new">
                    <Plus className="h-4 w-4 mr-2" />
                    New Venue
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
          <Link to="/admin/events">View all events</Link>
        </Button>
        <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
          <Link to="/admin/venues">View all venues</Link>
        </Button>
        <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
          <Link to="/">Go to main site</Link>
        </Button>
      </div>
    </div>
  )
}
