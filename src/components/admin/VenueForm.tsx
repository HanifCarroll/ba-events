import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { MapPin, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createVenueAction, updateVenueAction } from '@/lib/admin'
import { NEIGHBORHOODS, VENUE_TYPES } from '@/lib/types'
import type { Venue, VenueInsert, VenueUpdate, Neighborhood, VenueType } from '@/lib/types'

interface VenueFormProps {
  venue?: Venue
  mode: 'create' | 'edit'
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

export function VenueForm({ venue, mode }: VenueFormProps) {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState(venue?.name || '')
  const [neighborhood, setNeighborhood] = useState<Neighborhood | ''>(venue?.neighborhood || '')
  const [address, setAddress] = useState(venue?.address || '')
  const [website, setWebsite] = useState(venue?.website || '')
  const [instagram, setInstagram] = useState(venue?.instagram_handle || '')
  const [capacity, setCapacity] = useState(venue?.capacity?.toString() || '')
  const [type, setType] = useState<VenueType | ''>(venue?.type || 'other')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      if (mode === 'create') {
        const data: VenueInsert = {
          name,
          neighborhood: neighborhood as Neighborhood,
          address: address || null,
          website: website || null,
          instagram_handle: instagram || null,
          capacity: capacity ? parseInt(capacity, 10) : null,
          type: type as VenueType || 'other',
        }
        await createVenueAction({ data })
      } else if (venue) {
        const data: VenueUpdate = {
          name,
          neighborhood: neighborhood as Neighborhood,
          address: address || null,
          website: website || null,
          instagram_handle: instagram || null,
          capacity: capacity ? parseInt(capacity, 10) : null,
          type: type as VenueType || 'other',
        }
        await updateVenueAction({ data: { id: venue.id, data } })
      }

      navigate({ to: '/admin/venues' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save venue')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in-up">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
          <MapPin className="h-6 w-6 text-primary" />
          {mode === 'create' ? 'Add Venue' : 'Edit Venue'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {mode === 'create'
            ? 'Register a new venue'
            : `Editing ${venue?.name}`}
        </p>
        <div className="deco-line w-24 mt-4" />
      </div>

      {/* Form */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">Venue Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter venue name"
                required
                className="bg-background/50 border-border/50"
              />
            </div>

            {/* Neighborhood and Type row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Neighborhood */}
              <div className="space-y-2">
                <Label htmlFor="neighborhood">
                  Neighborhood <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={neighborhood}
                  onValueChange={(value) => setNeighborhood(value as Neighborhood)}
                  required
                >
                  <SelectTrigger className="bg-background/50 border-border/50">
                    <SelectValue placeholder="Select neighborhood" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {NEIGHBORHOODS.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Type */}
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select
                  value={type}
                  onValueChange={(value) => setType(value as VenueType)}
                >
                  <SelectTrigger className="bg-background/50 border-border/50">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {VENUE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {venueTypeLabels[t] || t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street address"
                className="bg-background/50 border-border/50"
              />
            </div>

            {/* Website and Instagram row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Website */}
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..."
                  className="bg-background/50 border-border/50"
                />
              </div>

              {/* Instagram */}
              <div className="space-y-2">
                <Label htmlFor="instagram">Instagram</Label>
                <Input
                  id="instagram"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  placeholder="@handle"
                  className="bg-background/50 border-border/50"
                />
              </div>
            </div>

            {/* Capacity */}
            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity</Label>
              <Input
                id="capacity"
                type="number"
                min="0"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="Maximum capacity"
                className="bg-background/50 border-border/50 max-w-[200px]"
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4 border-t border-border/50">
              <Button
                type="submit"
                disabled={isSubmitting || !name || !neighborhood}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : mode === 'create' ? (
                  'Create Venue'
                ) : (
                  'Save Changes'
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate({ to: '/admin/venues' })}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
