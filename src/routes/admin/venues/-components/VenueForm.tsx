import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { MapPin, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Combobox } from '@/shared/ui/combobox'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { useCreateVenue, useUpdateVenue, getVenuesForSelect } from '@/features/venues'
import { venueFormSchema, type VenueFormInput } from '@/shared/lib/schemas'
import { NEIGHBORHOODS } from '@/shared/lib/types'
import type { Venue, Neighborhood } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'

interface VenueFormProps {
  venue?: Venue
  mode: 'create' | 'edit'
}

export function VenueForm({ venue, mode }: VenueFormProps) {
  const navigate = useNavigate()
  const createMutation = useCreateVenue()
  const updateMutation = useUpdateVenue()

  // Fetch venues for parent selector
  const { data: allVenues = [] } = useQuery({
    queryKey: ['venues', 'for-select'],
    queryFn: () => getVenuesForSelect(),
  })

  // Filter venues that can be parents:
  // - Must not already have a parent (no grandchildren allowed)
  // - Must not be the current venue (when editing)
  const parentVenueOptions = useMemo(() => {
    const options = allVenues
      .filter((v) => !v.parent_id && v.id !== venue?.id)
      .map((v) => ({
        value: v.id,
        label: v.name + (v.neighborhood ? ` (${v.neighborhood})` : ''),
      }))
    return [{ value: '', label: m.admin_no_parent_venue() }, ...options]
  }, [allVenues, venue?.id])

  const form = useForm<VenueFormInput>({
    resolver: zodResolver(venueFormSchema),
    defaultValues: {
      name: venue?.name || '',
      neighborhood: venue?.neighborhood || ('' as Neighborhood),
      address: venue?.address || '',
      website: venue?.website || '',
      instagram_handle: venue?.instagram_handle || '',
      parent_id: venue?.parent_id || null,
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
        parent_id: data.parent_id || null,
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

              {/* Parent Venue */}
              <FormField
                control={form.control}
                name="parent_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{m.admin_parent_venue()}</FormLabel>
                    <FormControl>
                      <Combobox
                        options={parentVenueOptions}
                        value={field.value || ''}
                        onValueChange={(value) => field.onChange(value || null)}
                        placeholder={m.admin_select_parent_venue()}
                        searchPlaceholder={m.admin_search_parent_venues()}
                        emptyText={m.admin_no_venues_found()}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
