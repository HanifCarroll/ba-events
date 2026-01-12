import { useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Calendar, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Checkbox } from '@/shared/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Combobox } from '@/shared/ui/combobox'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { getVenuesForSelect } from '@/features/venues'
import { useCreateEvent, useUpdateEvent } from '@/features/events'
import { eventFormSchema, type EventFormInput } from '@/shared/lib/schemas'
import { CATEGORIES, EVENT_STATUSES } from '@/shared/lib/types'
import type { Event, EventStatus, Category } from '@/shared/lib/types'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query'

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
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function EventForm({ event, mode }: EventFormProps) {
  const navigate = useNavigate()
  const createMutation = useCreateEvent()
  const updateMutation = useUpdateEvent()

  // Load venues
  const { data: venues = [] } = useQuery({
    queryKey: queryKeys.venues.select(),
    queryFn: getVenuesForSelect,
  })

  const form = useForm<EventFormInput>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      name: event?.name || '',
      description_es: event?.description_es || '',
      description_en: event?.description_en || '',
      starts_at: toLocalDatetime(event?.starts_at),
      ends_at: toLocalDatetime(event?.ends_at) || '',
      is_all_day: event?.is_all_day || false,
      venue_id: event?.venue_id || '_none',
      location_tba: event?.location_tba || false,
      categories: (event?.categories || []) as Category[],
      price: event?.price ?? undefined,
      is_free: event?.is_free || false,
      min_age: event?.min_age ?? undefined,
      link: event?.link || '',
      ticket_url: event?.ticket_url || '',
      status: event?.status || 'scheduled',
      source: 'manual',
    },
  })

  const isFree = form.watch('is_free')

  // Clear price when is_free is checked
  useEffect(() => {
    if (isFree) {
      form.setValue('price', undefined)
    }
  }, [isFree, form])

  async function onSubmit(data: EventFormInput) {
    try {
      const startsAtISO = new Date(data.starts_at).toISOString()
      const endsAtISO = data.ends_at ? new Date(data.ends_at).toISOString() : null

      const submitData = {
        name: data.name,
        description_es: data.description_es || null,
        description_en: data.description_en || null,
        starts_at: startsAtISO,
        ends_at: endsAtISO,
        is_all_day: data.is_all_day,
        venue_id: data.venue_id === '_none' ? null : data.venue_id,
        location_tba: data.location_tba,
        categories: data.categories,
        price: data.price ?? null,
        is_free: data.is_free,
        min_age: data.min_age ?? null,
        link: data.link || null,
        ticket_url: data.ticket_url || null,
        source: 'manual',
        status: data.status,
      }

      if (mode === 'create') {
        await createMutation.mutateAsync(submitData)
      } else if (event) {
        await updateMutation.mutateAsync({ id: event.id, data: submitData })
      }

      navigate({ to: '/admin/events' })
    } catch {
      // Error is handled by mutation state
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending
  const error = createMutation.error || updateMutation.error

  return (
    <div className="max-w-3xl mx-auto animate-fade-in-up">
      {/* Header */}
      <div className="mb-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 text-muted-foreground hover:text-foreground"
        >
          <Link to="/admin/events">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Events
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          {mode === 'create' ? 'Add Event' : 'Edit Event'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {mode === 'create' ? 'Create a new event' : `Editing ${event?.name}`}
        </p>
        <div className="deco-line w-24 mt-4" />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic info */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg text-foreground">Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Name <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Event name"
                        className="bg-background/50 border-border/50"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description (Spanish) */}
              <FormField
                control={form.control}
                name="description_es"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Spanish)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value || ''}
                        placeholder="Describe el evento..."
                        rows={4}
                        className="bg-background/50 border-border/50 resize-none"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description (English) */}
              <FormField
                control={form.control}
                name="description_en"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (English)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value || ''}
                        placeholder="Describe the event..."
                        rows={4}
                        className="bg-background/50 border-border/50 resize-none"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Status */}
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="bg-background/50 border-border/50 max-w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EVENT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {statusLabels[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                <FormField
                  control={form.control}
                  name="starts_at"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Starts at <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="datetime-local"
                          className="bg-background/50 border-border/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Ends at */}
                <FormField
                  control={form.control}
                  name="ends_at"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ends at</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value || ''}
                          type="datetime-local"
                          className="bg-background/50 border-border/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* All day */}
              <FormField
                control={form.control}
                name="is_all_day"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="font-normal cursor-pointer">
                      All-day event
                    </FormLabel>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Venue */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg text-foreground">Venue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="venue_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select venue</FormLabel>
                    <FormControl>
                      <Combobox
                        options={[
                          { value: '_none', label: 'No venue' },
                          ...venues.map((v) => ({
                            value: v.id,
                            label: v.name,
                            sublabel: v.neighborhood ?? undefined,
                          })),
                        ]}
                        value={field.value || '_none'}
                        onValueChange={(value) => field.onChange(value || '_none')}
                        placeholder="Choose a venue"
                        searchPlaceholder="Search venues..."
                        emptyText="No venue found."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Venue TBA */}
              <FormField
                control={form.control}
                name="location_tba"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="font-normal cursor-pointer">
                      Venue TBA (location to be announced)
                    </FormLabel>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Categories */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg text-foreground">Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <Controller
                control={form.control}
                name="categories"
                render={({ field }) => (
                  <div className="space-y-3">
                    <FormLabel>Select category</FormLabel>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map((cat) => {
                        const isSelected = field.value.includes(cat)
                        return (
                          <Badge
                            key={cat}
                            variant="outline"
                            onClick={() => {
                              const newValue = isSelected
                                ? field.value.filter((c: string) => c !== cat)
                                : [...field.value, cat]
                              field.onChange(newValue)
                            }}
                            className={`cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-primary/20 text-primary border-primary/50'
                                : 'border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                            }`}
                          >
                            {cat}
                          </Badge>
                        )
                      })}
                    </div>
                  </div>
                )}
              />
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg text-foreground">Pricing & Age</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Free checkbox */}
              <FormField
                control={form.control}
                name="is_free"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="font-normal cursor-pointer">
                      Free event
                    </FormLabel>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Price */}
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price (ARS)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)
                          }
                          placeholder="0.00"
                          disabled={isFree}
                          className="bg-background/50 border-border/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Min age */}
                <FormField
                  control={form.control}
                  name="min_age"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Age</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value ? parseInt(e.target.value, 10) : undefined)
                          }
                          placeholder="All ages"
                          className="bg-background/50 border-border/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                <FormField
                  control={form.control}
                  name="link"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event Link</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value || ''}
                          type="url"
                          placeholder="https://..."
                          className="bg-background/50 border-border/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Ticket URL */}
                <FormField
                  control={form.control}
                  name="ticket_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ticket URL</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value || ''}
                          type="url"
                          placeholder="https://..."
                          className="bg-background/50 border-border/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error instanceof Error ? error.message : 'Failed to save event'}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
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
      </Form>
    </div>
  )
}
