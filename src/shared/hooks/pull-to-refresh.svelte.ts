import { refreshAll } from '$app/navigation';
import type { Attachment } from 'svelte/attachments';
import { createActor } from 'xstate';
import { pullToRefreshMachine } from './pull-to-refresh.machine.ts';

export interface PullToRefreshOptions {
	/** Callback when refresh is triggered */
	onRefresh?: () => void | Promise<void>;
	/** Threshold in pixels to trigger refresh (default: 80) */
	threshold?: number;
	/** Maximum pull distance in pixels (default: 128) */
	maxPull?: number;
	/** Whether pull-to-refresh is enabled (default: true) */
	enabled?: boolean;
}

/**
 * Pull-to-refresh attachment for internal scroll containers.
 *
 * Uses direct DOM manipulation during touch for 60fps performance, avoiding
 * Svelte state updates that cause lag. Attach it to the scrollable container;
 * it finds the indicator via `[data-pull-indicator]` (rendered by
 * `PullToRefreshIndicator.svelte`).
 *
 * @example
 * ```svelte
 * <div {@attach pullToRefresh({ onRefresh: () => window.location.reload() })} class="overflow-y-auto">
 *   <PullToRefreshIndicator />
 *   {content}
 * </div>
 * ```
 */
export function pullToRefresh(options: PullToRefreshOptions = {}): Attachment<HTMLElement> {
	const {
		onRefresh = () => refreshAll(),
		threshold = 80,
		maxPull = 128,
		enabled = true
	} = options;

	return (container: HTMLElement) => {
		const actor = createActor(pullToRefreshMachine, { input: { threshold, maxPull, onRefresh } });

		// Update indicator DOM directly (no Svelte re-renders)
		const updateIndicator = (distance: number, refreshing: boolean) => {
			const indicator = container.querySelector<HTMLElement>('[data-pull-indicator]');
			if (!indicator) return;

			if (distance === 0 && !refreshing) {
				indicator.style.height = '0px';
				indicator.style.opacity = '0';
				indicator.querySelector('[data-pull-icon]')?.classList.remove('animate-spin');
				return;
			}

			// Calculate visual values
			const progress = Math.min(distance / threshold, 1);
			const rotation = progress * 180;
			const opacity = Math.min(distance / 30, 1);

			// Apply styles directly to DOM
			indicator.style.height = `${distance}px`;
			indicator.style.opacity = refreshing ? '1' : String(opacity);

			// Update inner icon rotation
			const icon = indicator.querySelector<HTMLElement>('[data-pull-icon]');
			if (icon) {
				if (refreshing) {
					icon.style.transform = '';
					icon.classList.add('animate-spin');
				} else {
					icon.classList.remove('animate-spin');
					icon.style.transform = `rotate(${rotation}deg)`;
				}

				// Change color when threshold reached
				const iconSvg = icon.querySelector('svg');
				if (iconSvg) {
					iconSvg.style.color = progress >= 1 ? 'var(--primary)' : 'var(--primary-60)';
				}
			}
		};

		const subscription = actor.subscribe((snapshot) => {
			const refreshing = snapshot.matches('refreshing');
			updateIndicator(refreshing ? threshold : snapshot.context.distance, refreshing);
		});
		actor.start();

		const handleTouchStart = (event: TouchEvent) => {
			if (!enabled || !event.touches[0] || actor.getSnapshot().matches('refreshing')) return;
			// Horizontal carousels own their gestures.
			if (container.scrollTop > 0 || (event.target instanceof Element && event.target.closest('[data-horizontal-scroll]'))) {
				actor.send({ type: 'CANCEL' });
				return;
			}
			const indicator = container.querySelector<HTMLElement>('[data-pull-indicator]');
			if (indicator) indicator.style.transition = 'none';
			actor.send({ type: 'START', y: event.touches[0].clientY });
		};

		const handleTouchMove = (event: TouchEvent) => {
			if (!enabled || !event.touches[0] || !actor.getSnapshot().matches('tracking')) return;
			if (container.scrollTop > 0) {
				actor.send({ type: 'CANCEL' });
				return;
			}
			actor.send({ type: 'MOVE', y: event.touches[0].clientY });
			if (actor.getSnapshot().context.distance > 10) event.preventDefault();
		};

		const handleTouchEnd = () => {
			const indicator = container.querySelector<HTMLElement>('[data-pull-indicator]');
			if (indicator) indicator.style.transition = 'height 0.2s ease-out, opacity 0.2s ease-out';
			actor.send({ type: 'END' });
		};
		const handleTouchCancel = () => actor.send({ type: 'CANCEL' });

		// Use passive: false for touchmove to allow preventDefault
		container.addEventListener('touchstart', handleTouchStart, { passive: true });
		container.addEventListener('touchmove', handleTouchMove, { passive: false });
		container.addEventListener('touchend', handleTouchEnd, { passive: true });
		container.addEventListener('touchcancel', handleTouchCancel, { passive: true });

		return () => {
			container.removeEventListener('touchstart', handleTouchStart);
			container.removeEventListener('touchmove', handleTouchMove);
			container.removeEventListener('touchend', handleTouchEnd);
			container.removeEventListener('touchcancel', handleTouchCancel);
			subscription.unsubscribe();
			actor.stop();
			updateIndicator(0, false);
		};
	};
}
