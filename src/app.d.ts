// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { User } from '@supabase/supabase-js';
import type { Profile } from '#shared/lib/types.ts';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: User | null;
			profile: Profile | null;
			isAdmin: boolean;
		}
		// interface PageData {}
		interface PageState {
			selectedEvent?: import('./routes/events/[id]/$types').PageData;
			chatResponse?: { eventId: string; responseId: string };
		}
		// interface Platform {}
	}
}

export {};
