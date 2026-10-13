import type { Preview } from '@storybook/sveltekit';
import { INITIAL_VIEWPORTS } from 'storybook/viewport';
import { setLocale } from '#paraglide/runtime.js';
import '../src/app.css';
import './preview.css';
import Frame from './Frame.svelte';
import { auth } from './mocks/auth.svelte.ts';
import { track } from './mocks/analytics.ts';
import { resetSavedMocks } from './mocks/saved.ts';
import { resetSpeechMocks } from './mocks/speech.ts';

const preview: Preview = {
	globalTypes: {
		locale: {
			description: 'UI and fixture language',
			toolbar: {
				icon: 'globe', dynamicTitle: true,
				items: [{ value: 'es', title: 'Español' }, { value: 'en', title: 'English' }]
			}
		}
	},
	initialGlobals: { locale: 'es' },
	parameters: {
		layout: 'fullscreen',
		viewport: { options: INITIAL_VIEWPORTS },
		controls: { expanded: true },
		a11y: { test: 'error' },
		sveltekit_experimental: {
			state: { page: { url: new URL('https://storybook.example/chat/fixture'), state: {} } }
		}
	},
	beforeEach: () => {
		auth.user = null;
		auth.profile = null;
		auth.loading = false;
		auth.isAdmin = false;
		track.mockClear();
		resetSavedMocks();
		resetSpeechMocks();
	},
	decorators: [(_, { globals }) => {
		const locale = globals.locale === 'en' ? 'en' : 'es';
		setLocale(locale, { reload: false });
		document.documentElement.lang = locale;
		return { Component: Frame, props: { locale } };
	}]
};

export default preview;
