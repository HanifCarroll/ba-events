import { refreshAll } from '$app/navigation';
import type { Attachment } from 'svelte/attachments';

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
 * Attempt function for smooth pull resistance (exponential decay).
 * Prevents pulling too far while maintaining smooth feel.
 */
function applyResistance(distance: number, maxPull: number): number {
	const k = 0.4;
	return maxPull * (1 - Math.exp((-k * distance) / maxPull));
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
		// Touch tracking (no state updates during touch!)
		let touchStartY = 0;
		let currentPull = 0;
		let isAtTop = false;
		let isPulling = false;
		let isRefreshing = false;

		// Update indicator DOM directly (no Svelte re-renders)
		const updateIndicator = (distance: number, refreshing: boolean) => {
			const indicator = container.querySelector<HTMLElement>('[data-pull-indicator]');
			if (!indicator) return;

			if (distance === 0 && !refreshing) {
				indicator.style.height = '0px';
				indicator.style.opacity = '0';
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

		const handleTouchStart = (e: TouchEvent) => {
			if (!enabled || isRefreshing) return;

			// Horizontal carousels own their gestures. Letting pull-to-refresh track
			// the same touch can cancel a slightly diagonal swipe on mobile.
			if (e.target instanceof Element && e.target.closest('[data-horizontal-scroll]')) {
				isAtTop = false;
				return;
			}

			// Only enable pull-to-refresh when scrolled to top
			isAtTop = container.scrollTop <= 0;
			if (!isAtTop) return;

			touchStartY = e.touches[0].clientY;
			currentPull = 0;
			isPulling = false;

			// Remove transition during touch for responsive feel
			const indicator = container.querySelector<HTMLElement>('[data-pull-indicator]');
			if (indicator) {
				indicator.style.transition = 'none';
			}
		};

		const handleTouchMove = (e: TouchEvent) => {
			if (!enabled || isRefreshing || !isAtTop) return;

			// Re-check if at top (user might have scrolled)
			if (container.scrollTop > 0) {
				isAtTop = false;
				isPulling = false;
				updateIndicator(0, false);
				return;
			}

			const touchY = e.touches[0].clientY;
			const deltaY = touchY - touchStartY;

			// Only trigger on pull down (positive delta)
			if (deltaY <= 0) {
				isPulling = false;
				updateIndicator(0, false);
				currentPull = 0;
				return;
			}

			// Apply resistance for natural feel
			const adjustedPull = applyResistance(deltaY, maxPull);
			currentPull = adjustedPull;
			isPulling = true;

			// Update DOM directly (no state!)
			updateIndicator(adjustedPull, false);

			// Prevent default scrolling while pulling
			if (adjustedPull > 10) {
				e.preventDefault();
			}
		};

		const handleTouchEnd = async () => {
			if (!enabled || isRefreshing) return;

			const pulled = currentPull;
			const indicator = container.querySelector<HTMLElement>('[data-pull-indicator]');

			// Add transition for smooth snap-back
			if (indicator) {
				indicator.style.transition = 'height 0.2s ease-out, opacity 0.2s ease-out';
			}

			if (pulled >= threshold) {
				// Trigger refresh
				isRefreshing = true;
				updateIndicator(threshold, true); // Hold at threshold during refresh

				try {
					await onRefresh();
				} finally {
					isRefreshing = false;
					updateIndicator(0, false);
				}
			} else {
				// Snap back
				updateIndicator(0, false);
			}

			isPulling = false;
			currentPull = 0;
			isAtTop = false;
		};

		// Use passive: false for touchmove to allow preventDefault
		container.addEventListener('touchstart', handleTouchStart, { passive: true });
		container.addEventListener('touchmove', handleTouchMove, { passive: false });
		container.addEventListener('touchend', handleTouchEnd, { passive: true });

		return () => {
			container.removeEventListener('touchstart', handleTouchStart);
			container.removeEventListener('touchmove', handleTouchMove);
			container.removeEventListener('touchend', handleTouchEnd);
		};
	};
}
