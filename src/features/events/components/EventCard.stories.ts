import type { Meta, StoryObj } from '@storybook/sveltekit';
import { expect, waitFor } from 'storybook/test';
import * as m from '#paraglide/messages.js';
import EventCard from './EventCard.svelte';
import { fixtureLocale, fixtureUser, localizeText, makeEvent } from '../../../../.storybook/fixtures.ts';
import { auth } from '../../../../.storybook/mocks/auth.svelte.ts';
import { isEventSaved, saveEvent, unsaveEvent } from '../../../../.storybook/mocks/saved.ts';

const meta = {
	title: 'Events/EventCard', component: EventCard, tags: ['autodocs'],
	args: { event: makeEvent(), source: 'chat', variant: 'default' },
	argTypes: {
		variant: { control: 'select', options: ['default', 'hero'] },
		source: { control: 'select', options: ['chat', 'saved_page'] }
	},
	decorators: [(Story, { args, globals }) => Story({
		args: {
			...args,
			commentary: args.commentary && localizeText(args.commentary, fixtureLocale(globals.locale)),
			tips: args.tips?.map((tip: string) => localizeText(tip, fixtureLocale(globals.locale)))
		}
	})],
	play: async ({ canvas, args }) => {
		await waitFor(() => expect(canvas.getByRole('heading', { name: args.event.name })).toBeVisible());
		const details = canvas.getByRole('link', {
			name: args.variant === 'hero' ? m.concierge_event_details() : m.event_details_short()
		});
		expect(details).toHaveAttribute('href', args.source === 'chat'
			? `/chat/fixture?event=${args.event.id}` : `/events/${args.event.id}`);
	}
} satisfies Meta<typeof EventCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async (context) => {
		await meta.play(context);
		expect(context.canvas.getAllByText('Club del Sur').some((node) => node.checkVisibility())).toBe(true);
		const source = context.canvas.getByRole('link', { name: /Eventbrite/ });
		expect(source).toHaveAttribute('href', context.args.event.ticket_url!);
	}
};
export const Hero: Story = {
	args: {
		variant: 'hero', commentary: 'Un espacio íntimo para escuchar jazz con amigos.',
		tips: ['Llegá unos minutos antes para elegir una buena mesa.']
	},
	play: async (context) => {
		await meta.play(context);
		const locale = fixtureLocale(context.globals.locale);
		expect(context.canvas.getByText(localizeText(context.args.commentary!, locale))).toBeVisible();
		expect(context.canvas.getByText(localizeText(context.args.tips![0], locale))).toBeVisible();
	}
};
export const LongTitle: Story = {
	args: { event: makeEvent({ name: 'Jazz en San Telmo: encuentro de músicos y una noche de improvisación con invitados de toda Buenos Aires' }) }
};
export const MissingArtwork: Story = {
	args: { event: makeEvent({ image_url: null, image_width: null, image_height: null }), variant: 'hero' },
	play: async (context) => {
		await meta.play(context);
		expect(context.canvasElement.querySelector('img')).toBeNull();
	}
};
export const FreeAdmission: Story = {
	args: { event: makeEvent({ price: 0, is_free: true }) },
	play: async (context) => {
		await meta.play(context);
		expect(context.canvas.getAllByText(m.event_free()).some((node) => node.checkVisibility())).toBe(true);
	}
};
export const UnknownDetails: Story = {
	args: { event: makeEvent({ price: null, time_tba: true, venue_name: null, venue_neighborhood: null, venue_address: null, location_tba: true }) },
	play: async (context) => {
		await meta.play(context);
		for (const label of [m.event_price_tba(), m.concierge_time_tba(), m.concierge_location_tba()]) {
			expect(context.canvas.getAllByText(label).some((node) => node.checkVisibility())).toBe(true);
		}
	}
};
export const Guest: Story = {
	play: async (context) => {
		await meta.play(context);
		expect(context.canvas.getByRole('link', { name: m.event_sign_in_to_save() })).toHaveAttribute('href', '/login');
		expect(isEventSaved).not.toHaveBeenCalled();
	}
};
export const SignedInSaveAndUnsave: Story = {
	beforeEach: () => { auth.user = fixtureUser; },
	play: async (context) => {
		await meta.play(context);
		const button = context.canvas.getByRole('button', { name: m.event_save() });
		await waitFor(() => expect(isEventSaved).toHaveBeenCalledWith(context.args.event.id));
		expect(button).toHaveAttribute('aria-pressed', 'false');
		await context.userEvent.click(button);
		await waitFor(() => expect(saveEvent).toHaveBeenCalledWith(context.args.event.id));
		await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
		await waitFor(() => expect(button).toBeEnabled());
		await context.userEvent.click(button);
		await waitFor(() => expect(unsaveEvent).toHaveBeenCalledWith(context.args.event.id));
		await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
	}
};
export const AlreadySaved: Story = {
	beforeEach: () => {
		auth.user = fixtureUser;
		isEventSaved.mockResolvedValue(true);
	},
	play: async (context) => {
		await meta.play(context);
		await waitFor(() => expect(context.canvas.getByRole('button', { name: new RegExp(m.event_remove_from_saved()) })).toHaveAttribute('aria-pressed', 'true'));
	}
};
