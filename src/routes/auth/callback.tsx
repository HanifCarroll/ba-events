import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { EmailOtpType } from '@supabase/supabase-js'
import { exchangeCodeForSession, fetchProfile, getSupabaseBrowserClient } from '@/lib/auth'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
})

function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Completing sign in...')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const client = getSupabaseBrowserClient()

        // Helper to redirect
        const redirectTo = (path: string) => {
          setStatus('Redirecting...')
          window.location.href = path
        }

        // Helper to complete auth and redirect
        const completeAuth = async (userId: string) => {
          setStatus('Fetching profile...')
          const profile = await fetchProfile(userId)
          redirectTo(profile?.role === 'admin' ? '/admin' : '/')
        }

        // First, check if we already have a session (page refresh after auth)
        const { data: existingSession } = await client.auth.getSession()
        if (existingSession.session?.user) {
          setStatus('Session found, redirecting...')
          await completeAuth(existingSession.session.user.id)
          return
        }

        const urlParams = new URLSearchParams(window.location.search)

        // Method 1: token_hash (Magic Link with PKCE - recommended for SSR)
        const tokenHash = urlParams.get('token_hash')
        const type = urlParams.get('type') as EmailOtpType | null

        if (tokenHash && type) {
          setStatus('Verifying magic link...')
          const { data, error: verifyError } = await client.auth.verifyOtp({
            token_hash: tokenHash,
            type: type,
          })

          if (verifyError) {
            console.error('Error verifying OTP:', verifyError)
            setError(verifyError.message || 'Failed to verify magic link')
            return
          }

          if (!data.session?.user) {
            setError('Failed to create session')
            return
          }

          await completeAuth(data.session.user.id)
          return
        }

        // Method 2: code (PKCE code exchange)
        const code = urlParams.get('code')

        if (code) {
          setStatus('Exchanging code for session...')
          const { session } = await exchangeCodeForSession(code)

          if (!session?.user) {
            setError('Failed to create session')
            return
          }

          await completeAuth(session.user.id)
          return
        }

        // Method 3: hash-based params (implicit flow - legacy)
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')

        if (accessToken) {
          setStatus('Setting session from token...')
          const { data, error: sessionError } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          })

          if (sessionError) {
            console.error('Error setting session:', sessionError)
            setError('Failed to authenticate')
            return
          }

          if (!data.session?.user) {
            setError('Failed to create session')
            return
          }

          await completeAuth(data.session.user.id)
          return
        }

        // Check for error params
        const errorParam = urlParams.get('error') || hashParams.get('error')
        const errorDescription = urlParams.get('error_description') || hashParams.get('error_description')

        if (errorParam) {
          setError(errorDescription || errorParam)
          return
        }

        setError('No authentication token found. The link may have expired.')
      } catch (err) {
        console.error('Auth callback error:', err)
        setError(err instanceof Error ? err.message : 'Authentication failed')
      }
    }

    handleCallback()
  }, [])

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
        <p className="text-muted-foreground text-sm">{status}</p>
      </div>
    </div>
  )
}
