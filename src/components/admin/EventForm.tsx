import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Calendar, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createEventAction, updateEventAction, getVenuesForSelect } from '@/lib/admin'
import { CATEGORIES, VIBES, EVENT_STATUSES } from '@/lib/types'
import type { Event, EventInsert, EventUpdate, EventStatus, Category, Vibe } from '@/lib/types'

interface EventFormProps {
  event?: Event
  mode: 'create' | 'edit'
}

const statusLabels: Record<EventStatus, string> = {
  scheduled: 'Scheduled',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  past: 'Past',
  pending_review: 'Pending Review',
}

function toLocalDatetime(isoString: string | null | undefined): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  // Format: YYYY-MM-DDTHH:mm
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function EventForm({ event, mode }: EventFormProps) {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [venues, setVenues] = useState<{ id: string; name: string; neighborhood: string | null }[]>([])

  // Form state
  const [name, setName] = useState(event?.name || '')
  const [description, setDescription] = useState(event?.description || '')
  const [startsAt, setStartsAt] = useState(toLocalDatetime(event?.starts_at))
  const [endsAt, setEndsAt] = useState(toLocalDatetime(event?.ends_at))
  const [isAllDay, setIsAllDay] = useState(event?.is_all_day || false)
  const [venueId, setVenueId] = useState(event?.venue_id || '_none')
  const [categories, setCategories] = useState<Category[]>((event?.categories || []) as Category[])
  const [vibes, setVibes] = useState<Vibe[]>((event?.vibes || []) as Vibe[])
  const [price, setPrice] = useState(event?.price?.toString() || '')
  const [isFree, setIsFree] = useState(event?.is_free || false)
  const [minAge, setMinAge] = useState(event?.min_age?.toString() || '')
  const [link, setLink] = useState(event?.link || '')
  const [ticketUrl, setTicketUrl] = useState(event?.ticket_url || '')
  const [status, setStatus] = useState<EventStatus>(event?.status || 'scheduled')

  // Load venues on mount
  useEffect(() => {
    getVenuesForSelect().then(setVenues).catch(console.error)
  }, [])

  function toggleCategory(category: Category) {
    setCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    )
  }

  function toggleVibe(vibe: Vibe) {
    setVibes(prev =>
      prev.includes(vibe)
        ? prev.filter(v => v !== vibe)
        : [...prev, vibe]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const startsAtISO = new Date(startsAt).toISOString()
      const endsAtISO = endsAt ? new Date(endsAt).toISOString() : null

      if (mode === 'create') {
        const data: EventInsert = {
          name,
          description: description || null,
          starts_at: startsAtISO,
          ends_at: endsAtISO,
          is_all_day: isAllDay,
          venue_id: venueId === '_none' ? null : venueId,
          categories,
          vibes,
          price: price ? parseFloat(price) : null,
          is_free: isFree,
          min_age: minAge ? parseInt(minAge, 10) : null,
          link: link || null,
          ticket_url: ticketUrl || null,
          source: 'manual',
          status,
        }
        await createEventAction({ data })
      } else if (event) {
        const data: EventUpdate = {
          name,
          description: description || null,
          starts_at: startsAtISO,
          ends_at: endsAtISO,
          is_all_day: isAllDay,
          venue_id: venueId === '_none' ? null : venueId,
          categories,
          vibes,
          price: price ? parseFloat(price) : null,
          is_free: isFree,
          min_age: minAge ? parseInt(minAge, 10) : null,
          link: link || null,
          ticket_url: ticketUrl || null,
          status,
        }
        await updateEventAction({ data: { id: event.id, data } })
      }

      navigate({ to: '/admin/events' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in-up">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          {mode === 'create' ? 'Add Event' : 'Edit Event'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {mode === 'create'
            ? 'Create a new event'
            : `Editing ${event?.name}`}
        </p>
        <div className="deco-line w-24 mt-4" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Event name"
                required
                className="bg-background/50 border-border/50"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the event..."
                rows={4}
                className="bg-background/50 border-border/50 resize-none"
              />
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as EventStatus)}>
                <SelectTrigger className="bg-background/50 border-border/50 max-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabels[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Date and Time */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">Date & Time</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Starts at */}
              <div className="space-y-2">
                <Label htmlFor="starts_at">
                  Starts at <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="starts_at"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  required
                  className="bg-background/50 border-border/50"
                />
              </div>

              {/* Ends at */}
              <div className="space-y-2">
                <Label htmlFor="ends_at">Ends at</Label>
                <Input
                  id="ends_at"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="bg-background/50 border-border/50"
                />
              </div>
            </div>

            {/* All day */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_all_day"
                checked={isAllDay}
                onCheckedChange={(checked) => setIsAllDay(checked === true)}
              />
              <Label htmlFor="is_all_day" className="font-normal cursor-pointer">
                All-day event
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Venue */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">Venue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="venue">Select venue</Label>
              <Combobox
                options={[
                  { value: '_none', label: 'No venue' },
                  ...venues.map((v) => ({
                    value: v.id,
                    label: v.name,
                    sublabel: v.neighborhood ?? undefined,
                  })),
                ]}
                value={venueId}
                onValueChange={(value) => setVenueId(value || '_none')}
                placeholder="Choose a venue"
                searchPlaceholder="Search venues..."
                emptyText="No venue found."
              />
            </div>
          </CardContent>
        </Card>

        {/* Categories & Vibes */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">Categories & Vibes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Categories */}
            <div className="space-y-3">
              <Label>Categories</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <Badge
                    key={cat}
                    variant="outline"
                    onClick={() => toggleCategory(cat)}
                    className={`cursor-pointer transition-all ${
                      categories.includes(cat)
                        ? 'bg-primary/20 text-primary border-primary/50'
                        : 'border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                    }`}
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Vibes */}
            <div className="space-y-3">
              <Label>Vibes</Label>
              <div className="flex flex-wrap gap-2">
                {VIBES.map((vibe) => (
                  <Badge
                    key={vibe}
                    variant="outline"
                    onClick={() => toggleVibe(vibe)}
                    className={`cursor-pointer transition-all ${
                      vibes.includes(vibe)
                        ? 'bg-accent/20 text-accent border-accent/50'
                        : 'border-border/50 text-muted-foreground hover:border-accent/30 hover:text-foreground'
                    }`}
                  >
                    {vibe}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pricing */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">Pricing & Age</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Free checkbox */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_free"
                checked={isFree}
                onCheckedChange={(checked) => {
                  setIsFree(checked === true)
                  if (checked) setPrice('')
                }}
              />
              <Label htmlFor="is_free" className="font-normal cursor-pointer">
                Free event
              </Label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Price */}
              <div className="space-y-2">
                <Label htmlFor="price">Price (ARS)</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  disabled={isFree}
                  className="bg-background/50 border-border/50"
                />
              </div>

              {/* Min age */}
              <div className="space-y-2">
                <Label htmlFor="min_age">Minimum Age</Label>
                <Input
                  id="min_age"
                  type="number"
                  min="0"
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                  placeholder="All ages"
                  className="bg-background/50 border-border/50"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Links */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Event link */}
              <div className="space-y-2">
                <Label htmlFor="link">Event Link</Label>
                <Input
                  id="link"
                  type="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://..."
                  className="bg-background/50 border-border/50"
                />
              </div>

              {/* Ticket URL */}
              <div className="space-y-2">
                <Label htmlFor="ticket_url">Ticket URL</Label>
                <Input
                  id="ticket_url"
                  type="url"
                  value={ticketUrl}
                  onChange={(e) => setTicketUrl(e.target.value)}
                  placeholder="https://..."
                  className="bg-background/50 border-border/50"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4">
          <Button
            type="submit"
            disabled={isSubmitting || !name || !startsAt}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : mode === 'create' ? (
              'Create Event'
            ) : (
              'Save Changes'
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate({ to: '/admin/events' })}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
