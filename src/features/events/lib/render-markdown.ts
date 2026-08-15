import { browser } from '$app/env';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Svelte action: render sanitized markdown into an element. Actions only run
 * in the browser, so `DOMPurify` never touches the SSR path. This replaces the
 * legacy `react-markdown` rendering (react-markdown escaped raw HTML by
 * default; marked passes it through, so we sanitize with DOMPurify to match).
 */
export function renderMarkdown(node: HTMLElement, markdown: string | null) {
	const render = (value: string | null) => {
		if (browser && value) {
			node.innerHTML = DOMPurify.sanitize(
				marked.parse(value, { async: false }) as string
			);
		}
	};

	render(markdown);

	return {
		update(markdown: string | null) {
			render(markdown);
		}
	};
}
