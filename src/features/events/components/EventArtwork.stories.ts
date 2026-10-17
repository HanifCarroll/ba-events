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
		const container = image.closest('div')!;
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

export const SmallOriginal: Story = {
	args: {
		imageUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#244143"/></svg>')}`,
		imageWidth: 100, imageHeight: 100, aspectRatio: '4 / 3', class: 'w-[260px]'
	},
	play: async ({ canvasElement }) => {
		const image = canvasElement.querySelector('img')!;
		await image.decode();
		expect(image.naturalWidth).toBe(100);
		expect(image.getBoundingClientRect().width).toBe(100);
		expect(image.getBoundingClientRect().height).toBe(100);
	}
};

export const CachedSmallSource: Story = {
	args: {
		imageUrl: '/fixtures/poster-square-400.svg', imageWidth: null, imageHeight: null,
		aspectRatio: '4 / 3', class: 'w-[260px]'
	},
	play: async ({ canvasElement }) => {
		const image = canvasElement.querySelector('img')!;
		const frame = image.closest('div')!;
		await waitFor(() => expect(image.naturalWidth).toBeGreaterThan(0));
		const frameBefore = frame.getBoundingClientRect();
		const bounds: DOMRect[] = [];
		const naturalWidths: number[] = [];
		// A no-upscale source has 400 physical pixels even when a 640px variant
		// was requested. Switching candidates changes density-corrected naturalWidth.
		for (const candidate of [320, 640, 320]) {
			image.sizes = '260px';
			image.srcset = `/fixtures/poster-square-400.svg ${candidate}w`;
			await image.decode();
			bounds.push(image.getBoundingClientRect());
			naturalWidths.push(image.naturalWidth);
		}
		expect(naturalWidths[1]).toBeLessThan(frameBefore.height);
		expect(naturalWidths[1]).toBeLessThan(naturalWidths[0]);
		expect(bounds[1].width).toBeCloseTo(bounds[0].width, 0);
		expect(bounds[1].height).toBeCloseTo(bounds[0].height, 0);
		for (const box of bounds) {
			expect(box.width).toBeCloseTo(frameBefore.width, 0);
			expect(box.height).toBeCloseTo(frameBefore.height, 0);
		}
		expect(getComputedStyle(image).objectFit).toBe('contain');
		expect(frame.getBoundingClientRect().height).toBeCloseTo(frameBefore.height, 0);
	}
};
