// Auth Feature - Public API
// This is the public interface for the auth feature.
// Import from '@/features/auth' instead of reaching into internal modules.

// Client-side auth
export {
  getSupabaseBrowserClient,
  resetSupabaseBrowserClient,
  signInWithMagicLink,
  signOut,
  getSession,
  fetchProfile,
  exchangeCodeForSession,
  useAuth,
  updateDisplayName,
} from './api/client'

// Rate limiting
export {
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_REQUESTS,
  API_RATE_LIMIT_WINDOW_MS,
  checkRateLimit,
  checkApiRateLimit,
} from './api/rate-limit'

// Server-side auth actions
export {
  signOutAction,
  exchangeCodeAction,
  deleteAccountAction,
  updateLocalePreference,
} from './api/server'

// Session management
export {
  getSessionUser,
  requireAuth,
  requireAdmin,
  type SessionUser,
} from './api/session'

// Hooks
export { useAuthContext } from './hooks/useAuthContext'
export { useUpdateDisplayName, useDeleteAccount } from './hooks/useProfileMutations'
