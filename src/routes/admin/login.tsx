import { createFileRoute, redirect } from '@tanstack/react-router'

// Redirect old admin login to unified login page
export const Route = createFileRoute('/admin/login')({
  beforeLoad: () => {
    throw redirect({ to: '/login' })
  },
  component: () => null,
})
