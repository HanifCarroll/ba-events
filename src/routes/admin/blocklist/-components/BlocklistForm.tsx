import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Ban, Save } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { useCreateBlocklistEntry, useUpdateBlocklistEntry } from '@/features/import'
import {
  BLOCKLIST_TARGET_FIELDS,
  BLOCKLIST_SOURCES,
  type ImportBlocklistEntry,
  type BlocklistTargetField,
  type BlocklistSource,
} from '@/shared/lib/types'

const blocklistFormSchema = z.object({
  pattern: z.string().min(1, 'Pattern is required').max(500, 'Pattern too long'),
  target_field: z.enum(BLOCKLIST_TARGET_FIELDS),
  source: z.enum(BLOCKLIST_SOURCES),
  reason: z.string().max(1000, 'Reason too long').optional().nullable(),
})

type BlocklistFormInput = z.infer<typeof blocklistFormSchema>

interface BlocklistFormProps {
  mode: 'create' | 'edit'
  entry?: ImportBlocklistEntry
}

const TARGET_FIELD_LABELS: Record<BlocklistTargetField, string> = {
  event_name: 'Event Name',
  venue_name: 'Venue Name',
}

const SOURCE_LABELS: Record<BlocklistSource, string> = {
  passline: 'Passline',
  eventbrite: 'Eventbrite',
  ba_tourism: 'BA Tourism',
  meetup: 'Meetup',
  luma: 'Luma',
  all: 'All Sources',
}

export function BlocklistForm({ mode, entry }: BlocklistFormProps) {
  const navigate = useNavigate()
  const createMutation = useCreateBlocklistEntry()
  const updateMutation = useUpdateBlocklistEntry()

  const form = useForm<BlocklistFormInput>({
    resolver: zodResolver(blocklistFormSchema),
    defaultValues: {
      pattern: entry?.pattern ?? '',
      target_field: entry?.target_field ?? 'event_name',
      source: entry?.source ?? 'all',
      reason: entry?.reason ?? '',
    },
  })

  async function onSubmit(data: BlocklistFormInput) {
    const submitData = {
      ...data,
      reason: data.reason || null,
    }

    if (mode === 'create') {
      await createMutation.mutateAsync(submitData)
    } else if (entry) {
      await updateMutation.mutateAsync({ id: entry.id, data: submitData })
    }

    navigate({ to: '/admin/blocklist' })
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: '/admin/blocklist' })}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Ban className="h-6 w-6 text-primary" />
            {mode === 'create' ? 'Add Blocklist Entry' : 'Edit Blocklist Entry'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {mode === 'create'
              ? 'Create a new pattern to filter out advertisement events.'
              : 'Update the blocklist entry pattern.'}
          </p>
        </div>
      </div>

      <div className="deco-line w-24" />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="font-display text-lg">Pattern Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Pattern */}
              <FormField
                control={form.control}
                name="pattern"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pattern</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., karaoke, consultar precio"
                        className="bg-background/50 border-border/50"
                      />
                    </FormControl>
                    <FormDescription>
                      Text to match (case-insensitive substring match).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Target Field */}
              <FormField
                control={form.control}
                name="target_field"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Match Against</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background/50 border-border/50">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BLOCKLIST_TARGET_FIELDS.map((targetField) => (
                          <SelectItem key={targetField} value={targetField}>
                            {TARGET_FIELD_LABELS[targetField]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Which field to check for the pattern.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Source */}
              <FormField
                control={form.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Import Source</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background/50 border-border/50">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BLOCKLIST_SOURCES.map((source) => (
                          <SelectItem key={source} value={source}>
                            {SOURCE_LABELS[source]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Apply this rule to a specific source or all sources.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Reason */}
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        placeholder="Why is this pattern blocked?"
                        className="bg-background/50 border-border/50 min-h-[80px]"
                      />
                    </FormControl>
                    <FormDescription>
                      Document why this pattern is blocked for future reference.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate({ to: '/admin/blocklist' })}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              <Save className="h-4 w-4 mr-2" />
              {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Entry' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
