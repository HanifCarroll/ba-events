import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { getVenuesForSelect } from '@/features/venues'
import { useUpdateEvent } from '@/features/events'
import { eventFormSchema, type EventFormInput } from '@/shared/lib/schemas'
import { queryKeys } from '@/shared/lib/query'
import { CATEGORIES, EVENT_STATUSES } from '@/shared/lib/types'
import type { EventWithVenue, EventStatus, Category } from '@/shared/lib/types'

interface EditEventSheetProps {
  event: EventWithVenue | null
  onClose: () => void
}

const statusLabels: Record<EventStatus, string> = {
  scheduled: 'Scheduled',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  past: 'Past',
  pending_review: 'Pending Review',
}

// Convert ISO to local datetime for input[type=datetime-local]
function toLocalDatetime(isoString: string | null | undefined): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function EditEventSheet({ event, onClose }: EditEventSheetProps) {
  const updateMutation = useUpdateEvent()

  // Load venues for dropdown (cached via React Query)
  const { data: venues = [] } = useQuery({
    queryKey: queryKeys.venues.select(),
    queryFn: getVenuesForSelect,
  })

  const form = useForm<EventFormInput>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      name: '',
      description_es: '',
      description_en: '',
      starts_at: '',
      ends_at: '',
      is_all_day: false,
      venue_id: '_none',
      location_tba: false,
      categories: [],
      price: undefined,
      is_free: false,
      link: '',
      ticket_url: '',
      status: 'scheduled',
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

  // Reset form when event changes (critical for controlled sheet!)
  useEffect(() => {
    if (event) {
      form.reset({
        name: event.name,
        description_es: event.description_es || '',
        description_en: event.description_en || '',
        starts_at: toLocalDatetime(event.starts_at),
        ends_at: toLocalDatetime(event.ends_at) || '',
        is_all_day: event.is_all_day || false,
        venue_id: event.venue_id || '_none',
        location_tba: event.location_tba || false,
        categories: (event.categories || []) as Category[],
        price: event.price ?? undefined,
        is_free: event.is_free || false,
        link: event.link || '',
        ticket_url: event.ticket_url || '',
        status: event.status || 'scheduled',
        source: event.source || 'manual',
      })
    }
  }, [event, form])

  async function onSubmit(data: EventFormInput) {
    if (!event) return

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
        link: data.link || null,
        ticket_url: data.ticket_url || null,
        status: data.status,
      }

      await updateMutation.mutateAsync({ id: event.id, data: submitData })
      onClose()
    } catch {
      // Error is handled by mutation's onError (shows toast)
    }
  }

  if (!event) return null

  return (
    <Sheet open={!!event} onOpenChange={() => onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto bg-card border-border/50">
        <SheetHeader>
          <SheetTitle className="font-display text-foreground">Edit Event</SheetTitle>
          <SheetDescription className="text-muted-foreground">
            Editing {event.name}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 px-4 py-4">
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

            {/* Status */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="bg-background/50 border-border/50">
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

            {/* Date/Time row */}
            <div className="grid grid-cols-2 gap-3">
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

            {/* Venue */}
            <FormField
              control={form.control}
              name="venue_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Venue</FormLabel>
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

            {/* Categories */}
            <Controller
              control={form.control}
              name="categories"
              render={({ field }) => (
                <div className="space-y-2">
                  <FormLabel>
                    Categories <span className="text-destructive">*</span>
                  </FormLabel>
                  <div className="flex flex-wrap gap-1.5">
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
                          className={`cursor-pointer transition-all text-xs ${
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
                      rows={3}
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
                      rows={3}
                      className="bg-background/50 border-border/50 resize-none"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Pricing row */}
            <div className="space-y-3">
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
                        className="bg-background/50 border-border/50 max-w-[200px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Links row */}
            <div className="grid grid-cols-2 gap-3">
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

            {/* Error message */}
            {updateMutation.error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {updateMutation.error instanceof Error
                  ? updateMutation.error.message
                  : 'Failed to save event'}
              </div>
            )}

            <SheetFooter className="gap-2 sm:gap-0 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
