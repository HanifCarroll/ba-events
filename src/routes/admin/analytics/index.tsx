import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

// Schema for URL search params
const analyticsSearchSchema = z.object({
  range: z.enum(['7d', '30d', '90d']).optional().catch('7d'),
})

export const Route = createFileRoute('/admin/analytics/')({
  validateSearch: analyticsSearchSchema,
})
