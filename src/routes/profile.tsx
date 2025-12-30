import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { User, Mail, Lock, Trash2, ArrowLeft, Check, AlertTriangle, Loader2 } from 'lucide-react'
import { useAuthContext } from '@/hooks/useAuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
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
} from '@/components/ui/alert-dialog'
import {
  displayNameSchema,
  changePasswordSchema,
  type DisplayNameInput,
  type ChangePasswordInput,
} from '@/lib/schemas'
import {
  useUpdateDisplayName,
  useUpdatePassword,
  useDeleteAccount,
} from '@/hooks/useProfileMutations'
import { requireAuth } from '@/lib/session'

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
            Back to discover
          </Link>

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                <User className="h-5 w-5 text-primary" />
              </div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                Account Settings
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
                Profile
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

            {/* Security Section */}
            <section className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6">
              <h2 className="font-display text-lg font-medium mb-4 flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary/60" />
                Security
              </h2>

              <PasswordForm />
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
// Password Form
// =============================================================================

function PasswordForm() {
  const [showSuccess, setShowSuccess] = useState(false)
  const mutation = useUpdatePassword()

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  const onSubmit = async (data: ChangePasswordInput) => {
    try {
      await mutation.mutateAsync(data.newPassword)
      setShowSuccess(true)
      form.reset()
      setTimeout(() => setShowSuccess(false), 3000)
    } catch {
      // Error is handled by mutation state
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm text-muted-foreground">
                New Password
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  placeholder="Enter new password"
                  className="bg-background/50 border-border/50 focus:border-primary/50"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm text-muted-foreground">
                Confirm New Password
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  placeholder="Confirm new password"
                  className="bg-background/50 border-border/50 focus:border-primary/50"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error
              ? mutation.error.message
              : 'Failed to update password'}
          </p>
        )}
        {showSuccess && (
          <p className="text-sm text-primary">Password updated!</p>
        )}

        <Button
          type="submit"
          disabled={mutation.isPending}
          variant="outline"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Update Password'
          )}
        </Button>
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
