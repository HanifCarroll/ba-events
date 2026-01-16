import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useCreateVenue } from '@/features/venues/hooks/useVenueMutations'
import { NEIGHBORHOODS, type Neighborhood } from '@/shared/lib/types'

const createVenueSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  neighborhood: z.string().optional(),
  address: z.string().optional(),
})

type CreateVenueFormData = z.infer<typeof createVenueSchema>

interface CreateVenueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-filled venue name (from search term) */
  initialName: string
  /** Called after successfully creating venue, with the new venue ID */
  onCreated: (venueId: string) => void
}

export function CreateVenueDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: CreateVenueDialogProps) {
  const createMutation = useCreateVenue()

  const form = useForm<CreateVenueFormData>({
    resolver: zodResolver(createVenueSchema),
    defaultValues: {
      name: initialName,
      neighborhood: '_none',
      address: '',
    },
  })

  // Reset form when dialog opens with new initial name
  const prevInitialName = form.getValues('name')
  if (open && initialName !== prevInitialName && !form.formState.isDirty) {
    form.reset({
      name: initialName,
      neighborhood: '_none',
      address: '',
    })
  }

  async function onSubmit(data: CreateVenueFormData) {
    try {
      const venue = await createMutation.mutateAsync({
        name: data.name,
        neighborhood:
          data.neighborhood && data.neighborhood !== '_none'
            ? (data.neighborhood as Neighborhood)
            : null,
        address: data.address || null,
      })

      form.reset()
      onOpenChange(false)
      onCreated(venue.id)
    } catch {
      // Error handled by mutation's onError (shows toast)
    }
  }

  function handleClose() {
    form.reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-card border-border/50">
        <DialogHeader>
          <DialogTitle className="font-display">Create New Venue</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Add a new venue to assign to this event.
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
                    Name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Venue name"
                      className="bg-background/50 border-border/50"
                      autoFocus
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
                  <FormLabel>Neighborhood</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="bg-background/50 border-border/50">
                        <SelectValue placeholder="Select neighborhood..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {NEIGHBORHOODS.map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

            {/* Error message */}
            {createMutation.error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : 'Failed to create venue'}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Venue'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
