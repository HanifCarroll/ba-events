import { getCookies, setCookie, setResponseHeader } from '@tanstack/react-start/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Creates a Supabase client for server-side use with cookie-based session management.
 * This client reads/writes auth tokens via HTTP cookies instead of localStorage.
 */
export function createSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({
          name,
          value,
        }))
      },
      setAll(cookies, headers) {
        cookies.forEach((cookie) => {
          setCookie(cookie.name, cookie.value, {
            ...cookie.options,
            secure: process.env.NODE_ENV === 'production',
          })
        })
        // Since @supabase/ssr 0.12, responses that mutate auth cookies must not
        // be cached by CDNs/proxies (one user's tokens could be served to
        // another). Apply the Cache-Control headers the library passes here.
        if (headers) {
          Object.entries(headers).forEach(([name, value]) => {
            setResponseHeader(name, value)
          })
        }
      },
    },
  })
}
