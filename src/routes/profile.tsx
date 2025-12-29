import { useState, useEffect } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { User, Mail, Lock, Trash2, ArrowLeft, Check, AlertTriangle } from 'lucide-react'
import { useAuthContext } from '@/components/AuthProvider'
import { updateDisplayName, updatePassword, deleteAccountAction, signOut } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const navigate = useNavigate()
  const { user, profile, loading: authLoading } = useAuthContext()

  // Display name state
  const [displayName, setDisplayName] = useState('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameSuccess, setDisplayNameSuccess] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)

  // Password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Delete account state
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: '/login' })
    }
  }, [user, authLoading, navigate])

  // Initialize display name from profile
  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name)
    }
  }, [profile])

  const handleUpdateDisplayName = async (e: React.FormEvent) => {
    e.preventDefault()
    setDisplayNameError(null)
    setDisplayNameSuccess(false)
    setDisplayNameSaving(true)

    try {
      await updateDisplayName(displayName)
      setDisplayNameSuccess(true)
      setTimeout(() => setDisplayNameSuccess(false), 3000)
    } catch (err) {
      setDisplayNameError(err instanceof Error ? err.message : 'Failed to update display name')
    } finally {
      setDisplayNameSaving(false)
    }
  }

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(false)

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }

    setPasswordSaving(true)

    try {
      await updatePassword(newPassword)
      setPasswordSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSuccess(false), 3000)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to update password')
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!user || deleteConfirmText !== 'DELETE') return

    setDeleteError(null)
    setDeleting(true)

    try {
      await deleteAccountAction({ data: { userId: user.id } })
      await signOut()
      navigate({ to: '/' })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account')
      setDeleting(false)
    }
  }

  if (authLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return null
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

              {/* Display Name */}
              <form onSubmit={handleUpdateDisplayName}>
                <div className="space-y-2">
                  <Label htmlFor="displayName" className="text-sm text-muted-foreground">
                    Display Name
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="displayName"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter your display name"
                      className="bg-background/50 border-border/50 focus:border-primary/50"
                    />
                    <Button
                      type="submit"
                      disabled={displayNameSaving || displayName === profile?.display_name}
                      className="shrink-0"
                    >
                      {displayNameSaving ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : displayNameSuccess ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        'Save'
                      )}
                    </Button>
                  </div>
                  {displayNameError && (
                    <p className="text-sm text-destructive">{displayNameError}</p>
                  )}
                  {displayNameSuccess && (
                    <p className="text-sm text-primary">Display name updated!</p>
                  )}
                </div>
              </form>
            </section>

            {/* Security Section */}
            <section className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6">
              <h2 className="font-display text-lg font-medium mb-4 flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary/60" />
                Security
              </h2>

              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-sm text-muted-foreground">
                    New Password
                  </Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="bg-background/50 border-border/50 focus:border-primary/50"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm text-muted-foreground">
                    Confirm New Password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="bg-background/50 border-border/50 focus:border-primary/50"
                  />
                </div>

                {passwordError && (
                  <p className="text-sm text-destructive">{passwordError}</p>
                )}
                {passwordSuccess && (
                  <p className="text-sm text-primary">Password updated!</p>
                )}

                <Button
                  type="submit"
                  disabled={passwordSaving || !newPassword || !confirmPassword}
                  variant="outline"
                >
                  {passwordSaving ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    'Update Password'
                  )}
                </Button>
              </form>
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
                    {deleteError && (
                      <p className="mt-2 text-sm text-destructive">{deleteError}</p>
                    )}
                  </div>

                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setDeleteConfirmText('')}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAccount}
                      disabled={deleteConfirmText !== 'DELETE' || deleting}
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    >
                      {deleting ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        'Delete Account'
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
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
