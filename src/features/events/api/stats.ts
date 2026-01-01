import { createServerFn } from '@tanstack/react-start'
import { getAdminStatsFromDb } from '@/shared/lib/db/client'

export const getAdminStats = createServerFn({ method: 'GET' }).handler(async () => {
  return getAdminStatsFromDb()
})
