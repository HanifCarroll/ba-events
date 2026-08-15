import { createServerClient } from '@supabase/ssr'
import type { RequestEvent } from '@sveltejs/kit'

export function createSupabaseServerClient(event: RequestEvent) {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => event.cookies.getAll(),
      setAll: (cookies) =>
        cookies.forEach(({ name, value, options }) =>
          event.cookies.set(name, value, { ...options, path: options?.path ?? '/' })
        ),
    },
  })
}
