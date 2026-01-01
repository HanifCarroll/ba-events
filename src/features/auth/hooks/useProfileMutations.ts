import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateDisplayName, updatePassword, signOut } from '@/features/auth/api/client'
import { deleteAccountAction } from '@/features/auth/api/server'
import { queryKeys } from '@/shared/lib/query'

export function useUpdateDisplayName() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (displayName: string) => updateDisplayName(displayName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all })
    },
  })
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: (newPassword: string) => updatePassword(newPassword),
  })
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (userId: string) => {
      await deleteAccountAction({ data: { userId } })
      await signOut()
    },
  })
}
