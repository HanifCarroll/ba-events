import { fn } from 'storybook/test';

export const isEventSaved = fn<(eventId: string) => Promise<boolean>>().mockResolvedValue(false);
export const saveEvent = fn<(eventId: string) => Promise<boolean>>().mockResolvedValue(true);
export const unsaveEvent = fn<(eventId: string) => Promise<boolean>>().mockResolvedValue(true);

export function resetSavedMocks() {
	isEventSaved.mockReset().mockResolvedValue(false);
	saveEvent.mockReset().mockResolvedValue(true);
	unsaveEvent.mockReset().mockResolvedValue(true);
}
