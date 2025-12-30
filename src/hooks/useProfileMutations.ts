import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateDisplayName, updatePassword, signOut } from '@/lib/auth/client'
import { deleteAccountAction } from '@/lib/auth/server'
import { queryKeys } from '@/lib/query'

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
