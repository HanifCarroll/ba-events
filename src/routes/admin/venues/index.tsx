import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Plus, Pencil, Trash2, MapPin } from 'lucide-react'
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
import { listVenues, deleteVenueAction } from '@/lib/admin'
import type { Venue } from '@/lib/types'

export const Route = createFileRoute('/admin/venues/')({
  loader: async () => {
    return listVenues()
  },
  component: VenueListPage,
})

function VenueListPage() {
  const venues = Route.useLoaderData()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      await deleteVenueAction({ data: deleteTarget.id })
      setDeleteTarget(null)
      router.invalidate()
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  const venueTypeLabels: Record<string, string> = {
    club: 'Club',
    bar: 'Bar',
    theater: 'Theater',
    gallery: 'Gallery',
    cultural_center: 'Cultural Center',
    outdoor: 'Outdoor',
    restaurant: 'Restaurant',
    other: 'Other',
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" />
            Venues
          </h1>
          <p className="text-muted-foreground mt-1">{venues.length} venues registered</p>
        </div>
        <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Link to="/admin/venues/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Venue
          </Link>
        </Button>
      </div>

      <div className="deco-line w-24" />

      {/* Table */}
      {venues.length === 0 ? (
        <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
          <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground mb-2">No venues yet</h3>
          <p className="text-muted-foreground mb-4">Get started by adding your first venue.</p>
          <Button asChild className="bg-primary text-primary-foreground">
            <Link to="/admin/venues/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Venue
            </Link>
          </Button>
        </div>
      ) : (
        <div className="bg-card/50 rounded-xl border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-muted-foreground font-medium">Name</TableHead>
                <TableHead className="text-muted-foreground font-medium">Neighborhood</TableHead>
                <TableHead className="text-muted-foreground font-medium">Type</TableHead>
                <TableHead className="text-muted-foreground font-medium">Capacity</TableHead>
                <TableHead className="text-muted-foreground font-medium text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venues.map((venue) => (
                <TableRow
                  key={venue.id}
                  className="border-border/30 hover:bg-muted/30 transition-colors"
                >
                  <TableCell className="font-medium text-foreground">
                    {venue.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-primary/30 text-primary">
                      {venue.neighborhood}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {venueTypeLabels[venue.type] || venue.type}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {venue.capacity || '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      >
                        <Link to="/admin/venues/$id" params={{ id: venue.id }}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(venue)}
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
            <DialogTitle className="font-display text-foreground">Delete Venue</DialogTitle>
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
