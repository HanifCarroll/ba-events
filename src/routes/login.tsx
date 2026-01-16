import { useState } from 'react'
import { createFileRoute, useNavigate, Link, redirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Mail, Lock, Sparkles, ArrowRight, Check } from 'lucide-react'
import { signInWithMagicLink } from '@/features/auth/api/client'
import { signInAction } from '@/features/auth/api/server'
import { getSessionUser } from '@/features/auth/api/session'
import { track } from '@/lib/analytics'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import * as m from '@/paraglide/messages'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    // Redirect to home if already logged in
    const session = await getSessionUser()
    if (session) {
      throw redirect({ to: session.isAdmin ? '/admin' : '/' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const result = await signInAction({ data: { email, password } })
      track('auth:login_completed', { method: 'password' })
      // Invalidate session cache so sidebar updates
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      // Server action sets cookies, navigate based on role
      navigate({ to: result.isAdmin ? '/admin' : '/' })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign in'
      track('auth:login_failed', { method: 'password', error: errorMessage })
      setError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await signInWithMagicLink(email)
      track('auth:login_completed', { method: 'magic_link' })
      setMagicLinkSent(true)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send magic link'
      track('auth:login_failed', { method: 'magic_link', error: errorMessage })
      setError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-6 overflow-auto">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-[0.02]">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-primary" />
            <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="0.3" className="text-primary" />
            <circle cx="50" cy="50" r="25" fill="none" stroke="currentColor" strokeWidth="0.2" className="text-primary" />
          </svg>
        </div>
      </div>

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-1 h-8 bg-gradient-to-b from-primary to-accent rounded-full" />
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {m.login_welcome()}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">
            {m.login_subtitle()}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-1 p-1 mb-6 bg-card/30 rounded-lg border border-border/30">
          <button
            type="button"
            onClick={() => { setMode('password'); setError(null); setMagicLinkSent(false) }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-200 ${
              mode === 'password'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Lock className="h-4 w-4" />
            {m.login_password_tab()}
          </button>
          <button
            type="button"
            onClick={() => { setMode('magic'); setError(null) }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-200 ${
              mode === 'magic'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {m.login_magic_tab()}
          </button>
        </div>

        {/* Forms */}
        <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-xl shadow-black/20">
          {mode === 'password' ? (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
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
                    {m.login_submit()}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-4">
              {magicLinkSent ? (
                <div className="text-center py-4">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
                    <Check className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-display text-lg font-medium mb-2">{m.login_check_email()}</h3>
                  <p className="text-muted-foreground text-sm">
                    {m.login_magic_sent({ email })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setMagicLinkSent(false)}
                    className="mt-4 text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    {m.login_send_another()}
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="magic-email" className="text-sm text-muted-foreground">
                      {m.login_email()}
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="magic-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="pl-10 bg-background/50 border-border/50 focus:border-primary/50"
                        required
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {m.login_magic_description()}
                  </p>

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
                        {m.login_magic_submit()}
                        <Sparkles className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            {m.login_no_account()}{' '}
            <Link
              to="/register"
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              {m.login_create_one()}
            </Link>
          </p>
        </div>

        {/* Decorative bottom element */}
        <div className="flex items-center justify-center gap-2 mt-8">
          <div className="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <div className="w-1.5 h-1.5 rounded-full bg-primary/30" />
          <div className="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>
      </div>
    </div>
  )
}
