import { z } from 'zod'
import {
  CATEGORIES,
  EVENT_STATUSES,
  NEIGHBORHOODS,
} from './types'

// =============================================================================
// Primitive schemas with proper transforms
// =============================================================================

const optionalNullableString = z
  .string()
  .optional()
  .transform((val) => (val === '' || val === undefined ? null : val))

const nullableNumber = z.coerce
  .number()
  .optional()
  .transform((val) => (val === undefined || Number.isNaN(val) ? null : val))

const urlSchema = z
  .string()
  .url('Must be a valid URL')
  .or(z.literal(''))
  .transform((val) => (val === '' ? null : val))

export const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
})

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

// =============================================================================
// Profile schemas
// =============================================================================

export const displayNameSchema = z.object({
  displayName: z.string().min(1, 'Display name is required').max(50, 'Display name too long'),
})

export type DisplayNameInput = z.infer<typeof displayNameSchema>

export const changeEmailSchema = z.object({
  newEmail: z.string().min(1, 'Email is required').email('Invalid email address'),
})

export type ChangeEmailInput = z.infer<typeof changeEmailSchema>

// =============================================================================
// Event schemas
// =============================================================================

// Form schema - used for React Hook Form validation (no transforms, no defaults)
export const eventFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  description_es: z.string(),
  description_en: z.string(),
  starts_at: z.string().min(1, 'Start date is required'),
  ends_at: z.string(),
  is_all_day: z.boolean(),
  venue_id: z.string(),
  location_tba: z.boolean(),
  description_unavailable: z.boolean(),
  categories: z.array(z.enum(CATEGORIES)).min(1, 'At least one category is required'),
  price: z.number().min(0).optional(),
  is_free: z.boolean(),
  link: z.string(),
  ticket_url: z.string(),
  status: z.enum(EVENT_STATUSES),
  source: z.string(),
})

export type EventFormInput = z.infer<typeof eventFormSchema>

// API schema with transforms for server-side use
export const eventSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  description_es: optionalNullableString,
  description_en: optionalNullableString,
  description_display_es: optionalNullableString,
  description_display_en: optionalNullableString,
  description_summary_es: optionalNullableString,
  description_summary_en: optionalNullableString,
  starts_at: z.string().min(1, 'Start date is required'),
  ends_at: optionalNullableString,
  is_all_day: z.boolean().default(false),
  venue_id: optionalNullableString,
  location_tba: z.boolean().default(false),
  description_unavailable: z.boolean().default(false),
  categories: z.array(z.enum(CATEGORIES)).default([]),
  price: nullableNumber,
  is_free: z.boolean().default(false),
  image_url: urlSchema.optional().nullable(),
  link: urlSchema.optional().nullable(),
  ticket_url: urlSchema.optional().nullable(),
  source: z.string().default('manual'),
  external_id: optionalNullableString,
  status: z.enum(EVENT_STATUSES).default('scheduled'),
})

export type EventInput = z.infer<typeof eventSchema>

// For creating events (server-side validation)
export const createEventSchema = eventSchema

// For updating events (all fields optional except id reference)
export const updateEventSchema = eventSchema.partial()

export type CreateEventInput = z.infer<typeof createEventSchema>
export type UpdateEventInput = z.infer<typeof updateEventSchema>

// =============================================================================
// Venue schemas
// =============================================================================

// Form schema - used for React Hook Form validation (no transforms)
export const venueFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  neighborhood: z.enum(NEIGHBORHOODS, { message: 'Neighborhood is required' }),
  address: z.string(),
  website: z.string(),
  instagram_handle: z.string(),
  parent_id: z.string().nullable().optional(),
})

export type VenueFormInput = z.infer<typeof venueFormSchema>

// API schema with transforms for server-side use
export const venueSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  neighborhood: z.enum(NEIGHBORHOODS).nullable().optional(),
  address: optionalNullableString,
  website: urlSchema.optional().nullable(),
  instagram_handle: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val === '') return null
      // Remove @ prefix if present
      return val.startsWith('@') ? val.slice(1) : val
    }),
  parent_id: z.string().uuid().nullable().optional(),
})

export type VenueInput = z.infer<typeof venueSchema>

export const createVenueSchema = venueSchema
export const updateVenueSchema = venueSchema.partial()

export type CreateVenueInput = z.infer<typeof createVenueSchema>
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>

// =============================================================================
// Filter schemas
// =============================================================================

export const eventFiltersSchema = z.object({
  startsAfter: z.string().optional(),
  startsBefore: z.string().optional(),
  neighborhood: z.enum(NEIGHBORHOODS).optional(),
  venueId: z.string().uuid().optional(),
  categories: z.array(z.enum(CATEGORIES)).optional(),
  isFree: z.boolean().optional(),
  maxPrice: z.number().min(0).optional(),
  minAge: z.number().min(0).max(99).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
})

export type EventFiltersInput = z.infer<typeof eventFiltersSchema>
