import type { Meta, StoryObj } from '@storybook/sveltekit';
import { expect, waitFor } from 'storybook/test';
import EventArtwork from './EventArtwork.svelte';

const meta = {
	title: 'Events/EventArtwork', component: EventArtwork, tags: ['autodocs'],
	args: {
		imageUrl: '/fixtures/poster-portrait.svg', imageWidth: 480, imageHeight: 720,
		alt: 'Jazz — San Telmo', loading: 'eager', class: 'w-full max-w-sm'
	},
	play: async ({ canvasElement, args }) => {
		const image = canvasElement.querySelector('img')!;
		await waitFor(() => expect(image.naturalWidth).toBeGreaterThan(0));
		expect(image.complete).toBe(true);
		expect(image.alt).toBe(args.alt);
		expect(getComputedStyle(image).objectFit).toBe('contain');
		const container = image.parentElement!;
		const expectedRatio = args.aspectRatio ?? (
			args.imageWidth && args.imageHeight ? `${args.imageWidth} / ${args.imageHeight}` : 'auto'
		);
		expect(getComputedStyle(container).aspectRatio).toBe(expectedRatio);
		const bounds = image.getBoundingClientRect();
		const frame = container.getBoundingClientRect();
		expect(bounds.width).toBeLessThanOrEqual(frame.width + 1);
		expect(bounds.height).toBeLessThanOrEqual(frame.height + 1);
		// object-contain preserves the poster inside its box even when the box is square.
		if (!args.aspectRatio) {
			expect(bounds.width / bounds.height).toBeCloseTo(image.naturalWidth / image.naturalHeight, 2);
		}
	}
} satisfies Meta<typeof EventArtwork>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Portrait: Story = {};
export const Landscape: Story = { args: { imageUrl: '/fixtures/poster-landscape.svg', imageWidth: 960, imageHeight: 480 } };
export const Square: Story = { args: { imageUrl: '/fixtures/poster-square.svg', imageWidth: 480, imageHeight: 480 } };
export const MissingDimensions: Story = { args: { imageWidth: null, imageHeight: null } };
export const ExplicitContainerRatio: Story = { args: { aspectRatio: '1 / 1' } };
