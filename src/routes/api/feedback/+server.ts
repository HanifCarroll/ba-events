import { json, type RequestHandler } from '@sveltejs/kit'
import { checkApiRateLimit } from '#features/auth/api/rate-limit.server.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'

const MAX_FEEDBACK_LENGTH = 2000

export const POST: RequestHandler = async (event) => {
	const ip =
		event.getClientAddress() ||
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		event.request.headers.get('x-real-ip') ||
		'unknown'
	const limit = await checkApiRateLimit(ip)
	if (!limit.success) {
		return json({ error: 'Please wait before sending more feedback.' }, { status: 429 })
	}

	let message: string

  try {
    const body = (await event.request.json()) as { message?: unknown }
    message = typeof body.message === 'string' ? body.message.trim() : ''
  } catch {
    return json({ error: 'Feedback must be valid JSON.' }, { status: 400 })
  }

  if (!message || message.length > MAX_FEEDBACK_LENGTH) {
    return json({ error: `Feedback must be between 1 and ${MAX_FEEDBACK_LENGTH} characters.` }, { status: 400 })
  }

  const supabase = createSupabaseServerClient(event)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await getSupabaseServiceRoleClient()
    .from('product_feedback')
    .insert({ message, user_id: user?.id ?? null })

  if (error) {
    console.error('[feedback] failed to store submission:', error.code)
    return json({ error: 'Unable to send feedback right now.' }, { status: 500 })
  }

  return json({ success: true })
}
