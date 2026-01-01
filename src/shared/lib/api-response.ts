// Standardized API Response Format
// Use these helpers for consistent API responses across all endpoints

// Success response for single items
export function apiSuccess<T>(data: T) {
  return { success: true as const, data }
}

// Success response for lists with pagination
export function apiList<T>(items: T[], total: number, page?: number, pageSize?: number) {
  return {
    success: true as const,
    data: items,
    meta: { total, page, pageSize, hasMore: page && pageSize ? (page * pageSize) < total : undefined }
  }
}

// Error response
export function apiError(message: string, code?: string) {
  return { success: false as const, error: { message, code } }
}

// Type helpers
export type ApiSuccess<T> = ReturnType<typeof apiSuccess<T>>
export type ApiList<T> = ReturnType<typeof apiList<T>>
export type ApiError = ReturnType<typeof apiError>

// Caching headers utility
export const CachePresets = {
  noStore: { 'Cache-Control': 'no-store' },
  short: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  medium: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' },
  long: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
} as const

export function withCache(headers: HeadersInit, preset: keyof typeof CachePresets): HeadersInit {
  return { ...headers, ...CachePresets[preset] }
}
