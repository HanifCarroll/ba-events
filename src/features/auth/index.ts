// Auth Feature - Public API
// This is the public interface for the auth feature.
// Import from '@/features/auth' instead of reaching into internal modules.

// Client-side auth
export {
  getSupabaseBrowserClient,
  resetSupabaseBrowserClient,
  signUp,
  signIn,
  signInWithMagicLink,
  signOut,
  getSession,
  fetchProfile,
  exchangeCodeForSession,
  useAuth,
  updateDisplayName,
  updatePassword,
} from './api/client'

// Rate limiting
export {
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW,
  checkRateLimit,
} from './api/rate-limit'

// Server-side auth actions
export {
  signInAction,
  signUpAction,
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
export { useUpdateDisplayName, useUpdatePassword, useDeleteAccount } from './hooks/useProfileMutations'
