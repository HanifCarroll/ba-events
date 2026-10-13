import type { Meta, StoryObj } from '@storybook/sveltekit';
import { expect, fn } from 'storybook/test';
import * as m from '#paraglide/messages.js';
import ChatInput from './ChatInput.svelte';

const meta = {
	title: 'Chat/ChatInput', component: ChatInput, tags: ['autodocs'],
	args: { onSend: fn(), onStop: fn(), disabled: false, canStop: false, emphasized: false }
} satisfies Meta<typeof ChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
	play: async ({ canvas, userEvent, args }) => {
		const input = canvas.getByRole('textbox', { name: m.chat_input_label() });
		const send = canvas.getByRole('button', { name: m.chat_send() });
		expect(send).toBeDisabled();
		await userEvent.type(input, '   ');
		expect(send).toBeDisabled();
		await userEvent.keyboard('{Enter}');
		expect(args.onSend).not.toHaveBeenCalled();
		await userEvent.clear(input);
	}
};
export const PopulatedMultiline: Story = {
	play: async ({ canvas, userEvent, args }) => {
		const input = canvas.getByRole('textbox', { name: m.chat_input_label() });
		await userEvent.type(input, 'Jazz{Shift>}{Enter}{/Shift}San Telmo');
		expect(input).toHaveValue('Jazz\nSan Telmo');
		expect(canvas.getByRole('button', { name: m.chat_send() })).toBeEnabled();
		expect(args.onSend).not.toHaveBeenCalled();
	}
};
export const EnterSubmits: Story = {
	play: async ({ canvas, userEvent, args }) => {
		const input = canvas.getByRole('textbox', { name: m.chat_input_label() });
		await userEvent.type(input, '  Jazz en San Telmo  ');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
		expect(args.onSend).not.toHaveBeenCalled();
		await userEvent.keyboard('{Enter}');
		expect(args.onSend).toHaveBeenCalledTimes(1);
		expect(args.onSend).toHaveBeenCalledWith('Jazz en San Telmo');
		expect(input).toHaveValue('');
	}
};
export const ButtonSubmits: Story = {
	play: async ({ canvas, userEvent, args }) => {
		const input = canvas.getByRole('textbox', { name: m.chat_input_label() });
		await userEvent.type(input, '  Jazz  ');
		await userEvent.click(canvas.getByRole('button', { name: m.chat_send() }));
		expect(args.onSend).toHaveBeenCalledTimes(1);
		expect(args.onSend).toHaveBeenCalledWith('Jazz');
		expect(input).toHaveValue('');
	}
};
export const Disabled: Story = {
	args: { disabled: true },
	play: async ({ canvas, userEvent, args }) => {
		const input = canvas.getByRole('textbox', { name: m.chat_input_label() });
		expect(input).toBeDisabled();
		await userEvent.type(input, 'Jazz{Enter}');
		expect(input).toHaveValue('');
		expect(canvas.getByRole('button', { name: m.chat_send() })).toBeDisabled();
		expect(args.onSend).not.toHaveBeenCalled();
	}
};
export const StopAvailable: Story = {
	args: { disabled: true, canStop: true },
	play: async ({ canvas, userEvent, args }) => {
		expect(canvas.queryByRole('button', { name: m.chat_send() })).toBeNull();
		await userEvent.click(canvas.getByRole('button', { name: m.chat_stop_response() }));
		expect(args.onStop).toHaveBeenCalledTimes(1);
		expect(args.onSend).not.toHaveBeenCalled();
	}
};
export const Emphasized: Story = {
	args: { emphasized: true },
	play: async ({ canvas }) => {
		expect(canvas.getByText(m.home_composer_label())).toBeVisible();
		expect(canvas.getByRole('textbox', { name: m.chat_input_label() })).toBeVisible();
	}
};
export const UnsupportedDictation: Story = {
	play: async ({ canvas }) => {
		const microphone = canvas.getByRole('button', { name: m.chat_dictate() });
		expect(microphone).toBeDisabled();
		expect(microphone).toHaveAttribute('title', m.chat_dictate_unsupported());
	}
};
