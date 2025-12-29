import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { MapPin, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useCreateVenue, useUpdateVenue } from '@/hooks/useVenueMutations'
import { venueFormSchema, type VenueFormInput } from '@/lib/schemas'
import { NEIGHBORHOODS, VENUE_TYPES } from '@/lib/types'
import type { Venue, Neighborhood } from '@/lib/types'

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
  const createMutation = useCreateVenue()
  const updateMutation = useUpdateVenue()

  const form = useForm<VenueFormInput>({
    resolver: zodResolver(venueFormSchema),
    defaultValues: {
      name: venue?.name || '',
      neighborhood: venue?.neighborhood || ('' as Neighborhood),
      address: venue?.address || '',
      website: venue?.website || '',
      instagram_handle: venue?.instagram_handle || '',
      capacity: venue?.capacity ?? undefined,
      type: venue?.type || 'other',
    },
  })

  async function onSubmit(data: VenueFormInput) {
    try {
      const submitData = {
        name: data.name,
        neighborhood: data.neighborhood,
        address: data.address || null,
        website: data.website || null,
        instagram_handle: data.instagram_handle || null,
        capacity: data.capacity ?? null,
        type: data.type,
      }

      if (mode === 'create') {
        await createMutation.mutateAsync(submitData)
      } else if (venue) {
        await updateMutation.mutateAsync({ id: venue.id, data: submitData })
      }

      navigate({ to: '/admin/venues' })
    } catch {
      // Error is handled by mutation state
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending
  const error = createMutation.error || updateMutation.error

  return (
    <div className="max-w-2xl mx-auto animate-fade-in-up">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
          <MapPin className="h-6 w-6 text-primary" />
          {mode === 'create' ? 'Add Venue' : 'Edit Venue'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {mode === 'create' ? 'Register a new venue' : `Editing ${venue?.name}`}
        </p>
        <div className="deco-line w-24 mt-4" />
      </div>

      {/* Form */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">Venue Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
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
                        placeholder="Enter venue name"
                        className="bg-background/50 border-border/50"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Neighborhood and Type row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Neighborhood */}
                <FormField
                  control={form.control}
                  name="neighborhood"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Neighborhood <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Combobox
                          options={NEIGHBORHOODS.map((n) => ({ value: n, label: n }))}
                          value={field.value || undefined}
                          onValueChange={(value) => field.onChange(value as Neighborhood)}
                          placeholder="Select neighborhood"
                          searchPlaceholder="Search neighborhoods..."
                          emptyText="No neighborhood found."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Type */}
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="bg-background/50 border-border/50">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {VENUE_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {venueTypeLabels[t] || t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Address */}
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Street address"
                        className="bg-background/50 border-border/50"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Website and Instagram row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Website */}
                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="url"
                          placeholder="https://..."
                          className="bg-background/50 border-border/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Instagram */}
                <FormField
                  control={form.control}
                  name="instagram_handle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instagram</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="@handle"
                          className="bg-background/50 border-border/50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Capacity */}
              <FormField
                control={form.control}
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacity</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value ? parseInt(e.target.value, 10) : undefined)
                        }
                        placeholder="Maximum capacity"
                        className="bg-background/50 border-border/50 max-w-[200px]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Error message */}
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  {error instanceof Error ? error.message : 'Failed to save venue'}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-4 border-t border-border/50">
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
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
