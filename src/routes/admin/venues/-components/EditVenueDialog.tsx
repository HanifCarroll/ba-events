import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Combobox } from '@/shared/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { useUpdateVenue, getVenuesForSelect } from '@/features/venues'
import { venueFormSchema, type VenueFormInput } from '@/shared/lib/schemas'
import { NEIGHBORHOODS } from '@/shared/lib/types'
import type { Venue, Neighborhood } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'

interface EditVenueDialogProps {
  venue: Venue | null
  suggestedName?: string
  onClose: () => void
}

export function EditVenueDialog({ venue, suggestedName, onClose }: EditVenueDialogProps) {
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
      name: '',
      neighborhood: '' as Neighborhood,
      address: '',
      website: '',
      instagram_handle: '',
      parent_id: null,
    },
  })

  // Reset form when venue changes
  useEffect(() => {
    if (venue) {
      form.reset({
        name: suggestedName || venue.name,
        neighborhood: venue.neighborhood || ('' as Neighborhood),
        address: venue.address || '',
        website: venue.website || '',
        instagram_handle: venue.instagram_handle || '',
        parent_id: venue.parent_id || null,
      })
    }
  }, [venue, suggestedName, form])

  async function onSubmit(data: VenueFormInput) {
    if (!venue) return

    try {
      const submitData = {
        name: data.name,
        neighborhood: data.neighborhood,
        address: data.address || null,
        website: data.website || null,
        instagram_handle: data.instagram_handle || null,
        parent_id: data.parent_id || null,
      }

      await updateMutation.mutateAsync({ id: venue.id, data: submitData })
      onClose()
    } catch {
      // Error is handled by mutation state
    }
  }

  if (!venue) return null

  const currentName = form.watch('name')
  const showSuggestedButton = suggestedName && suggestedName !== currentName

  return (
    <Dialog open={!!venue} onOpenChange={() => onClose()}>
      <DialogContent className="bg-card border-border/50 max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">
            {m.admin_edit_venue()}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {m.admin_edit_venue_desc()}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {m.admin_venue_name()} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={m.admin_enter_venue_name()}
                      className="bg-background/50 border-border/50"
                    />
                  </FormControl>
                  {showSuggestedButton && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-primary"
                      onClick={() => form.setValue('name', suggestedName)}
                    >
                      {m.admin_use_suggested({ name: suggestedName })}
                    </Button>
                  )}
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
                    {m.admin_neighborhood()} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Combobox
                      options={NEIGHBORHOODS.map((n) => ({ value: n, label: n }))}
                      value={field.value || undefined}
                      onValueChange={(value) => field.onChange(value as Neighborhood)}
                      placeholder={m.admin_select_neighborhood()}
                      searchPlaceholder={m.admin_search_neighborhoods()}
                      emptyText={m.admin_no_neighborhood()}
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
                  <FormLabel>{m.admin_address()}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={m.admin_street_address()}
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
                    <FormLabel>{m.admin_website()}</FormLabel>
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
                    <FormLabel>{m.admin_instagram()}</FormLabel>
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
            {updateMutation.error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {updateMutation.error instanceof Error
                  ? updateMutation.error.message
                  : m.admin_failed_to_save_venue()}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                className="text-muted-foreground"
              >
                {m.common_cancel()}
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {m.common_saving()}
                  </>
                ) : (
                  m.common_save()
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
