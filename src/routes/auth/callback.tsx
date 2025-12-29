import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { exchangeCodeForSession, fetchProfile } from '@/lib/auth'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
})

function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the code from URL params
        const urlParams = new URLSearchParams(window.location.search)
        const code = urlParams.get('code')

        if (!code) {
          // Check for hash-based params (Supabase sometimes uses this)
          const hashParams = new URLSearchParams(window.location.hash.substring(1))
          const accessToken = hashParams.get('access_token')

          if (accessToken) {
            // Token is already in the URL, Supabase client will handle it
            // Just wait a moment for the auth state to update
            await new Promise(resolve => setTimeout(resolve, 1000))
            navigate({ to: '/' })
            return
          }

          setError('No authentication code found')
          return
        }

        // Exchange the code for a session
        const { session } = await exchangeCodeForSession(code)

        if (!session?.user) {
          setError('Failed to create session')
          return
        }

        // Fetch user profile to check role
        const profile = await fetchProfile(session.user.id)

        // Redirect based on role
        if (profile?.role === 'admin') {
          navigate({ to: '/admin' })
        } else {
          navigate({ to: '/' })
        }
      } catch (err) {
        console.error('Auth callback error:', err)
        setError(err instanceof Error ? err.message : 'Authentication failed')
      }
    }

    handleCallback()
  }, [navigate])

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10 mb-4">
            <span className="text-destructive text-xl">!</span>
          </div>
          <h2 className="font-display text-lg font-medium mb-2">Authentication Error</h2>
          <p className="text-muted-foreground text-sm mb-4">{error}</p>
          <a
            href="/login"
            className="text-primary hover:text-primary/80 text-sm font-medium transition-colors"
          >
            Return to login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground text-sm">Completing sign in...</p>
      </div>
    </div>
  )
}
