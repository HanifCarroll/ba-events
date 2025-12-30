import { useState } from 'react'
import { createFileRoute, useNavigate, Link, redirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Mail, Lock, ArrowRight, Check } from 'lucide-react'
import { signUpAction } from '@/lib/auth'
import { getSessionUser } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import * as m from '@/paraglide/messages'

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    // Redirect to home if already logged in
    const session = await getSessionUser()
    if (session) {
      throw redirect({ to: '/' })
    }
  },
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(m.register_error_mismatch())
      return
    }

    if (password.length < 6) {
      setError(m.register_error_length())
      return
    }

    setIsSubmitting(true)

    try {
      const result = await signUpAction({ data: { email, password } })
      if (result.needsEmailConfirmation) {
        setSuccess(true)
      } else {
        // Auto-confirmed, invalidate session and navigate to home
        await queryClient.invalidateQueries({ queryKey: ['session'] })
        navigate({ to: '/' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-6 overflow-auto">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 -right-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 -left-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-[0.02]">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <polygon points="50,5 95,50 50,95 5,50" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-primary" />
            <polygon points="50,20 80,50 50,80 20,50" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-primary" />
          </svg>
        </div>
      </div>

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-1 h-8 bg-gradient-to-b from-accent to-primary rounded-full" />
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {m.register_title()}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">
            {m.register_subtitle()}
          </p>
        </div>

        {/* Form */}
        <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-xl shadow-black/20">
          {success ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
                <Check className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-display text-lg font-medium mb-2">{m.register_check_email()}</h3>
              <p className="text-muted-foreground text-sm mb-4">
                {m.register_confirm_sent({ email })}
              </p>
              <p className="text-xs text-muted-foreground">
                {m.register_click_link()}
              </p>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm text-muted-foreground">
                  {m.login_email()}
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="pl-10 bg-background/50 border-border/50 focus:border-primary/50"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm text-muted-foreground">
                  {m.login_password()}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 bg-background/50 border-border/50 focus:border-primary/50"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-sm text-muted-foreground">
                  {m.register_confirm_password()}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 bg-background/50 border-border/50 focus:border-primary/50"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    {m.register_submit()}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                {m.register_terms()}
              </p>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            {m.register_has_account()}{' '}
            <Link
              to="/login"
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              {m.register_signin_link()}
            </Link>
          </p>
        </div>

        {/* Decorative bottom element */}
        <div className="flex items-center justify-center gap-2 mt-8">
          <div className="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <div className="w-1.5 h-1.5 rounded-full bg-accent/30" />
          <div className="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>
      </div>
    </div>
  )
}
