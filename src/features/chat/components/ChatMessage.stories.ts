import type { Meta, StoryObj } from '@storybook/sveltekit';
import { expect, fn, waitFor } from 'storybook/test';
import ChatMessage from './ChatMessage.svelte';
import {
	clarificationFixture, fixtureLocale, localizeMessage, localizeText,
	makeEvent, makeMessage, suggestionFixture
} from '../../../../.storybook/fixtures.ts';

const meta = {
	title: 'Chat/ChatMessage', component: ChatMessage, tags: ['autodocs'],
	args: { message: makeMessage(), onSuggestionSelect: fn() },
	decorators: [(Story, { args, globals }) => Story({
		args: { ...args, message: localizeMessage(args.message, fixtureLocale(globals.locale)) }
	})]
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMessage: Story = {
	args: { message: makeMessage({ role: 'user', content: '¿Qué hay para hacer este fin de semana?' }) },
	play: async ({ canvas, args, globals }) => {
		await waitFor(() => expect(canvas.getByText(localizeText(args.message.content, fixtureLocale(globals.locale)))).toBeVisible());
	}
};
export const AssistantMarkdown: Story = {
	play: async ({ canvas, globals }) => {
		await waitFor(() => expect(canvas.getByText(globals.locale === 'en' ? 'Live jazz' : 'Jazz en vivo')).toBeVisible());
		expect(canvas.getAllByRole('listitem')).toHaveLength(2);
	}
};
export const StreamingText: Story = {
	args: { message: makeMessage({ content: 'Encontré algunas opciones para vos…', isStreaming: true }) },
	play: async ({ canvas, globals, args }) => {
		await waitFor(() => expect(canvas.getByText(localizeText(args.message.content, fixtureLocale(globals.locale)))).toBeVisible());
	}
};
export const EmptyStreamingMessage: Story = {
	args: { message: makeMessage({ content: '', isStreaming: true }) },
	play: async ({ canvasElement }) => {
		expect(canvasElement.querySelector('[data-message-id]')).toBeNull();
	}
};
export const SingleEvent: Story = {
	args: { message: makeMessage({ content: 'Estas opciones van con lo que buscás.', events: [makeEvent()] }) },
	play: async ({ canvas }) => {
		await waitFor(() => expect(canvas.getByRole('heading', { name: 'Jazz en San Telmo' })).toBeVisible());
	}
};
export const MultipleEvents: Story = {
	args: { message: makeMessage({ content: 'Estas opciones van con lo que buscás.', events: [
		makeEvent(), makeEvent({ id: '00000000-0000-4000-8000-000000000002', name: 'Jazz en Palermo', venue_name: 'Club del Norte', venue_neighborhood: 'Palermo' })
	] }) },
	play: async ({ canvas }) => {
		expect(canvas.getAllByRole('heading', { level: 3 })).toHaveLength(2);
	}
};
export const ClarificationQuestions: Story = {
	args: { message: makeMessage({ content: '', clarificationQuestions: [clarificationFixture] }) },
	play: async ({ canvas, globals }) => {
		expect(canvas.getAllByText(localizeText(clarificationFixture.label, fixtureLocale(globals.locale)))).toHaveLength(1);
	}
};
export const ClarificationAlreadyInContent: Story = {
	args: { message: makeMessage({ content: clarificationFixture.label, clarificationQuestions: [clarificationFixture] }) },
	play: ClarificationQuestions.play
};
export const HistoricalSuccessReceipt: Story = {
	parameters: { docs: { description: { story: 'Compatibility rendering for a historical save receipt. The current concierge does not mutate saved membership.' } } },
	args: { message: makeMessage({ content: '', operations: [{ toolCallId: 'historical-save', toolName: 'save_event', eventId: makeEvent().id, outcome: 'applied', message: 'Evento guardado.' }] }) },
	play: async ({ canvas, globals }) => {
		await waitFor(() => expect(canvas.getByText(localizeText('Evento guardado.', fixtureLocale(globals.locale)))).toBeVisible());
	}
};
export const HistoricalFailureReceipt: Story = {
	parameters: HistoricalSuccessReceipt.parameters,
	args: { message: makeMessage({ content: '', operations: [{ toolCallId: 'historical-save', toolName: 'save_event', eventId: makeEvent().id, outcome: 'failed', message: 'No se pudo guardar el evento.' }] }) },
	play: async ({ canvas, globals }) => {
		await waitFor(() => expect(canvas.getByText(localizeText('No se pudo guardar el evento.', fixtureLocale(globals.locale)))).toBeVisible());
	}
};
export const Suggestions: Story = {
	args: { message: makeMessage({ suggestions: [suggestionFixture] }) },
	play: async ({ canvas, userEvent, args, globals }) => {
		const locale = fixtureLocale(globals.locale);
		await userEvent.click(canvas.getByRole('button', { name: localizeText(suggestionFixture.label, locale) }));
		expect(args.onSuggestionSelect).toHaveBeenCalledTimes(1);
		expect(args.onSuggestionSelect).toHaveBeenCalledWith(localizeText(suggestionFixture.prompt, locale));
	}
};
export const DisabledSuggestions: Story = {
	args: { message: makeMessage({ suggestions: [suggestionFixture] }), suggestionsDisabled: true },
	play: async ({ canvas, userEvent, args, globals }) => {
		const button = canvas.getByRole('button', { name: localizeText(suggestionFixture.label, fixtureLocale(globals.locale)) });
		expect(button).toBeDisabled();
		await userEvent.click(button);
		expect(args.onSuggestionSelect).not.toHaveBeenCalled();
	}
};
export const UnsafeMarkdown: Story = {
	args: { message: makeMessage({ content: '**Jazz** <script>window.__storybookUnsafe=true</script><a href="javascript:alert(1)">unsafe link</a><span onclick="alert(1)">unsafe handler</span>' }) },
	play: async ({ canvasElement, canvas }) => {
		await waitFor(() => expect(canvas.getByText('Jazz')).toBeVisible());
		expect(canvasElement.querySelector('script, [onclick], [href^="javascript:"]')).toBeNull();
	}
};
