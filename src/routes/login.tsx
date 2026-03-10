import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Mail, Sparkles, Check } from 'lucide-react'
import { signInWithMagicLink } from '@/features/auth/api/client'
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
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await signInWithMagicLink(email)
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

        <div className="bg-card/40 backdrop-blur-sm border border-border/50 rounded-xl p-6 shadow-xl shadow-black/20">
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
                <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/50 px-3 py-1 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Magic-link sign in only
                </div>

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
                  {m.login_magic_description()} New accounts are created automatically when your email is allowed by Supabase.
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
        </div>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          Use the same email whether you are returning or signing in for the first time.
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
