import { useEffect, useState, useCallback } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { User, Mail, Trash2, ArrowLeft, Check, AlertTriangle, Loader2, Sparkles, Music, Palette, Utensils, Users, Dumbbell, PartyPopper, MapPin } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'
import {
  useUpdateDisplayName,
  useDeleteAccount,
} from '@/features/auth/hooks/useProfileMutations'
import { usePreferences, useUpdatePreferences } from '@/features/auth/hooks/usePreferences'
import { requireAuth } from '@/features/auth/api/session'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/ui/form'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import {
  displayNameSchema,
  type DisplayNameInput,
} from '@/shared/lib/schemas'
import { CATEGORIES, type Category, type Neighborhood } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'

// Popular neighborhoods for quick selection
const POPULAR_NEIGHBORHOODS: Neighborhood[] = [
  'Palermo',
  'San Telmo',
  'Recoleta',
  'Villa Crespo',
  'Belgrano',
  'Almagro',
  'Colegiales',
  'Núñez',
  'La Boca',
  'Puerto Madero',
]

// Category icons - labels are handled via i18n
const CATEGORY_ICONS: Record<Category, typeof Music> = {
  music: Music,
  arts: Palette,
  food: Utensils,
  social: Users,
  sports: Dumbbell,
  festival: PartyPopper,
}

// Get category label from i18n
function getCategoryLabel(category: Category): string {
  const labels: Record<Category, () => string> = {
    music: m.category_music,
    arts: m.category_arts,
    food: m.category_food,
    social: m.category_social,
    sports: m.category_sports,
    festival: m.category_festival,
  }
  return labels[category]()
}

export const Route = createFileRoute('/profile')({
  beforeLoad: async () => {
    await requireAuth({ data: { redirectTo: '/profile' } })
  },
  component: ProfilePage,
})

function ProfilePage() {
  const navigate = useNavigate()
  const { user, profile } = useAuthContext()

  // Delete account state (kept separate since it's in a dialog)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // Guard against edge case where context hasn't synced yet
  if (!user) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-auto">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 -right-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 -left-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        {/* Art deco corner accent */}
        <div className="absolute bottom-10 right-10 w-24 h-24 opacity-[0.03]">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <path d="M0 100 L0 60 L40 60 L40 0 L100 0 L100 100 Z" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
            <path d="M20 100 L20 80 L60 80 L60 20 L100 20" fill="none" stroke="currentColor" strokeWidth="1" className="text-primary" />
          </svg>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 px-6 py-6">
        <div className="max-w-2xl mx-auto">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            {m.profile_back()}
          </Link>

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                <User className="h-5 w-5 text-primary" />
              </div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                Profile
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">
              Manage your profile and account preferences
            </p>
          </div>

          <div className="space-y-6">
            {/* Profile Section */}
            <section className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6">
              <h2 className="font-display text-lg font-medium mb-4 flex items-center gap-2">
                <User className="h-4 w-4 text-primary/60" />
                Account
              </h2>

              {/* Email (read-only) */}
              <div className="mb-6">
                <Label className="text-sm text-muted-foreground">Email</Label>
                <div className="mt-1.5 flex items-center gap-3 px-3 py-2.5 rounded-lg bg-background/50 border border-border/50">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{user.email}</span>
                </div>
              </div>

              {/* Display Name Form */}
              <DisplayNameForm
                defaultDisplayName={profile?.display_name || ''}
              />
            </section>

            {/* Personalization Section */}
            <section className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6">
              <h2 className="font-display text-lg font-medium mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary/60" />
                {m.profile_personalization()}
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                {m.profile_personalization_desc()}
              </p>

              <PreferencesForm />
            </section>
            {/* Danger Zone */}
            <section className="bg-destructive/5 border border-destructive/20 rounded-xl p-6">
              <h2 className="font-display text-lg font-medium mb-2 flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Danger Zone
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>

              <DeleteAccountDialog
                userId={user.id}
                deleteConfirmText={deleteConfirmText}
                setDeleteConfirmText={setDeleteConfirmText}
                onDeleted={() => navigate({ to: '/' })}
              />
            </section>
          </div>

          {/* Decorative bottom element */}
          <div className="flex items-center justify-center gap-2 mt-10 mb-6">
            <div className="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            <div className="w-1.5 h-1.5 rounded-full bg-primary/30" />
            <div className="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Display Name Form
// =============================================================================

function DisplayNameForm({ defaultDisplayName }: { defaultDisplayName: string }) {
  const [showSuccess, setShowSuccess] = useState(false)
  const mutation = useUpdateDisplayName()

  const form = useForm<DisplayNameInput>({
    resolver: zodResolver(displayNameSchema),
    defaultValues: {
      displayName: defaultDisplayName,
    },
  })

  // Sync form when profile loads
  useEffect(() => {
    if (defaultDisplayName) {
      form.reset({ displayName: defaultDisplayName })
    }
  }, [defaultDisplayName, form])

  const onSubmit = async (data: DisplayNameInput) => {
    try {
      await mutation.mutateAsync(data.displayName)
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
    } catch {
      // Error is handled by mutation state
    }
  }

  const isDirty = form.watch('displayName') !== defaultDisplayName

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm text-muted-foreground">
                Display Name
              </FormLabel>
              <div className="flex gap-2">
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Enter your display name"
                    className="bg-background/50 border-border/50 focus:border-primary/50"
                  />
                </FormControl>
                <Button
                  type="submit"
                  disabled={mutation.isPending || !isDirty}
                  className="shrink-0"
                >
                  {mutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : showSuccess ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
              <FormMessage />
              {mutation.isError && (
                <p className="text-sm text-destructive">
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : 'Failed to update display name'}
                </p>
              )}
              {showSuccess && (
                <p className="text-sm text-primary">Display name updated!</p>
              )}
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}

// =============================================================================
// Delete Account Dialog
// =============================================================================

interface DeleteAccountDialogProps {
  userId: string
  deleteConfirmText: string
  setDeleteConfirmText: (text: string) => void
  onDeleted: () => void
}

function DeleteAccountDialog({
  userId,
  deleteConfirmText,
  setDeleteConfirmText,
  onDeleted,
}: DeleteAccountDialogProps) {
  const mutation = useDeleteAccount()

  const handleDelete = async () => {
    if (deleteConfirmText !== 'DELETE') return

    try {
      await mutation.mutateAsync(userId)
      onDeleted()
    } catch {
      // Error is handled by mutation state
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="gap-2">
          <Trash2 className="h-4 w-4" />
          Delete Account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-card border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete Account
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            This will permanently delete your account, including all your saved events.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-4">
          <Label htmlFor="deleteConfirm" className="text-sm text-muted-foreground">
            Type <span className="font-mono font-bold text-foreground">DELETE</span> to confirm
          </Label>
          <Input
            id="deleteConfirm"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
            className="mt-2 bg-background/50 border-border/50"
          />
          {mutation.isError && (
            <p className="mt-2 text-sm text-destructive">
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'Failed to delete account'}
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDeleteConfirmText('')}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteConfirmText !== 'DELETE' || mutation.isPending}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Delete Account'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// =============================================================================
// Preferences Form
// =============================================================================

function PreferencesForm() {
  const { data: preferences, isLoading } = usePreferences()
  const mutation = useUpdatePreferences()
  const [showSuccess, setShowSuccess] = useState(false)
  
  // Local state for form fields
  const [aboutMe, setAboutMe] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([])
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<Neighborhood[]>([])
  
  // Track if there are unsaved changes
  const [hasChanges, setHasChanges] = useState(false)

  // Sync local state when preferences load
  useEffect(() => {
    if (preferences) {
      setAboutMe(preferences.about_me || '')
      setSelectedCategories(preferences.preferred_categories || [])
      setSelectedNeighborhoods(preferences.preferred_neighborhoods || [])
    }
  }, [preferences])

  // Debounced save function
  const savePreferences = useCallback(async () => {
    if (!hasChanges) return
    
    try {
      await mutation.mutateAsync({
        about_me: aboutMe || null,
        preferred_categories: selectedCategories,
        preferred_neighborhoods: selectedNeighborhoods,
      })
      setShowSuccess(true)
      setHasChanges(false)
      setTimeout(() => setShowSuccess(false), 2000)
    } catch {
      // Error handled by mutation state
    }
  }, [aboutMe, selectedCategories, selectedNeighborhoods, hasChanges, mutation])

  // Toggle category selection
  const toggleCategory = (category: Category) => {
    setSelectedCategories(prev => {
      const newCategories = prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
      setHasChanges(true)
      return newCategories
    })
  }

  // Toggle neighborhood selection
  const toggleNeighborhood = (neighborhood: Neighborhood) => {
    setSelectedNeighborhoods(prev => {
      const newNeighborhoods = prev.includes(neighborhood)
        ? prev.filter(n => n !== neighborhood)
        : [...prev, neighborhood]
      setHasChanges(true)
      return newNeighborhoods
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* About Me */}
      <div>
        <Label htmlFor="aboutMe" className="text-sm text-muted-foreground">
          {m.profile_about_you()}
        </Label>
        <Textarea
          id="aboutMe"
          value={aboutMe}
          onChange={(e) => {
            setAboutMe(e.target.value)
            setHasChanges(true)
          }}
          placeholder={m.profile_about_placeholder()}
          className="mt-1.5 min-h-[100px] bg-background/50 border-border/50 focus:border-primary/50"
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          {m.profile_about_help()}
        </p>
      </div>

      {/* Event Categories */}
      <div>
        <Label className="text-sm text-muted-foreground">
          {m.profile_event_interests()}
        </Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category]
            const isSelected = selectedCategories.includes(category)
            
            return (
              <button
                key={category}
                type="button"
                onClick={() => toggleCategory(category)}
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                  isSelected
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-background/50 border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {getCategoryLabel(category)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Neighborhoods */}
      <div>
        <Label className="text-sm text-muted-foreground flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5" />
          {m.profile_preferred_neighborhoods()}
        </Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {POPULAR_NEIGHBORHOODS.map((neighborhood) => {
            const isSelected = selectedNeighborhoods.includes(neighborhood)
            
            return (
              <button
                key={neighborhood}
                type="button"
                onClick={() => toggleNeighborhood(neighborhood)}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-sm transition-all',
                  isSelected
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-background/50 border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                {neighborhood}
              </button>
            )
          })}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={savePreferences}
          disabled={mutation.isPending || !hasChanges}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : showSuccess ? (
            <>
              <Check className="h-4 w-4 mr-2" />
              {m.profile_saved()}
            </>
          ) : (
            m.profile_save_preferences()
          )}
        </Button>
        {mutation.isError && (
          <p className="text-sm text-destructive">
            {m.profile_save_failed()}
          </p>
        )}
      </div>
    </div>
  )
}
