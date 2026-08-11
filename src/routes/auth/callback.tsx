import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { exchangeCodeAction } from '@/features/auth/api/server'
import { track } from '@/lib/analytics'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
})

function AuthCallbackPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Completing sign in...')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search)
        const hashParams = new URLSearchParams(window.location.hash.substring(1))

        // Check for error params
        const errorParam = urlParams.get('error') || hashParams.get('error')
        const errorDescription =
          urlParams.get('error_description') || hashParams.get('error_description')

        if (errorParam) {
          setError(errorDescription || errorParam)
          return
        }

        // Get auth parameters
        const code = urlParams.get('code')
        const tokenHash = urlParams.get('token_hash')
        const type = urlParams.get('type')

        if (!code && !tokenHash) {
          setError('No authentication token found. The link may have expired.')
          return
        }

        setStatus('Verifying authentication...')

        // Call server function to exchange code/token for session (sets cookies)
        await exchangeCodeAction({
          data: {
            code: code || undefined,
            tokenHash: tokenHash || undefined,
            type: type || undefined,
          },
        })

        track('auth:login_completed', { method: 'magic_link' })
        // Invalidate session cache so sidebar updates
        await queryClient.invalidateQueries({ queryKey: ['session'] })
        // Navigate to home
        setStatus('Redirecting...')
        navigate({ to: '/' })
      } catch (err) {
        console.error('Auth callback error:', err)
        const errorMessage = err instanceof Error ? err.message : 'Authentication failed'
        track('auth:login_failed', { method: 'magic_link', error: errorMessage })
        setError(errorMessage)
      }
    }

    handleCallback()
  }, [navigate, queryClient])

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
