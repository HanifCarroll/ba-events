import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Plus, Pencil, Trash2, Calendar, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { listEvents, deleteEventAction } from '@/lib/admin'
import type { EventWithVenue } from '@/lib/types'

export const Route = createFileRoute('/admin/events/')({
  loader: async () => {
    return listEvents()
  },
  component: EventListPage,
})

function EventListPage() {
  const events = Route.useLoaderData()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<EventWithVenue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      await deleteEventAction({ data: deleteTarget.id })
      setDeleteTarget(null)
      router.invalidate()
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function getStatusBadge(status: string) {
    const variants: Record<string, { className: string; label: string }> = {
      scheduled: {
        className: 'bg-green-500/10 text-green-400 border-green-500/30',
        label: 'Scheduled',
      },
      cancelled: {
        className: 'bg-destructive/10 text-destructive border-destructive/30',
        label: 'Cancelled',
      },
      postponed: {
        className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
        label: 'Postponed',
      },
    }
    const variant = variants[status] || variants.scheduled
    return (
      <Badge variant="outline" className={variant.className}>
        {variant.label}
      </Badge>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Events
          </h1>
          <p className="text-muted-foreground mt-1">{events.length} events in database</p>
        </div>
        <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Link to="/admin/events/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Event
          </Link>
        </Button>
      </div>

      <div className="deco-line w-24" />

      {/* Table */}
      {events.length === 0 ? (
        <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
          <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground mb-2">No events yet</h3>
          <p className="text-muted-foreground mb-4">Get started by adding your first event.</p>
          <Button asChild className="bg-primary text-primary-foreground">
            <Link to="/admin/events/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Event
            </Link>
          </Button>
        </div>
      ) : (
        <div className="bg-card/50 rounded-xl border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-muted-foreground font-medium">Event</TableHead>
                <TableHead className="text-muted-foreground font-medium">Venue</TableHead>
                <TableHead className="text-muted-foreground font-medium">Date</TableHead>
                <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                <TableHead className="text-muted-foreground font-medium text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow
                  key={event.id}
                  className="border-border/30 hover:bg-muted/30 transition-colors"
                >
                  <TableCell>
                    <div>
                      <p className="font-medium text-foreground">{event.name}</p>
                      {event.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {event.categories.slice(0, 2).map((cat) => (
                            <Badge
                              key={cat}
                              variant="outline"
                              className="text-xs border-border/50 text-muted-foreground"
                            >
                              {cat}
                            </Badge>
                          ))}
                          {event.categories.length > 2 && (
                            <span className="text-xs text-muted-foreground">
                              +{event.categories.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {event.venue_name ? (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{event.venue_name}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(event.starts_at)}
                  </TableCell>
                  <TableCell>{getStatusBadge(event.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      >
                        <Link to={`/admin/events/${event.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(event)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Delete Event</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
