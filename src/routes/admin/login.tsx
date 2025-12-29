import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { KeyRound, Sparkles, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signIn, useAuth } from '@/lib/auth'

export const Route = createFileRoute('/admin/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Redirect if already logged in
  if (!loading && user) {
    navigate({ to: '/admin' })
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await signIn(email, password)
      navigate({ to: '/admin' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-accent/[0.05] pointer-events-none" />

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Card with warm glow */}
        <div className="relative">
          {/* Glow effect */}
          <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/10 to-accent/20 rounded-2xl blur-xl opacity-50" />

          {/* Card */}
          <div className="relative bg-card border border-border/50 rounded-2xl p-8 shadow-2xl">
            {/* Header */}
            <div className="text-center mb-8">
              {/* Logo accent */}
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-px w-8 bg-gradient-to-r from-transparent to-primary/50" />
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div className="h-px w-8 bg-gradient-to-l from-transparent to-primary/50" />
              </div>

              <h1 className="font-display text-2xl font-semibold text-foreground mb-2">
                Admin Access
              </h1>
              <p className="text-sm text-muted-foreground">
                Sign in to manage events and venues
              </p>

              <div className="deco-line w-24 mx-auto mt-4" />
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  autoComplete="email"
                  className="bg-background/50 border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-colors"
                />
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="bg-background/50 border-border/50 focus:border-primary/50 focus:ring-primary/20 transition-colors"
                />
              </div>

              {/* Error message */}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive animate-fade-in-up">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                disabled={isSubmitting || loading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 glow-gold-subtle hover:glow-gold"
              >
                {isSubmitting ? (
                  <>
                    <Sparkles className="h-4 w-4 mr-2 animate-pulse-warm" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>

            {/* Footer */}
            <div className="mt-6 text-center">
              <a
                href="/"
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Back to main site
              </a>
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute -top-4 -left-4 w-8 h-8 border-t-2 border-l-2 border-primary/30 rounded-tl-lg" />
        <div className="absolute -bottom-4 -right-4 w-8 h-8 border-b-2 border-r-2 border-primary/30 rounded-br-lg" />
      </div>
    </div>
  )
}
