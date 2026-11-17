// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Profile } from '#shared/lib/types.ts';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			chatTiming?: import('#features/chat/lib/timing.ts').ChatTiming;
			user: import('#shared/lib/types.ts').AuthUser | null;
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
