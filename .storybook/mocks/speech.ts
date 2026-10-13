import { fn } from 'storybook/test';
import type { RecognitionMode, SpeechRecognitionLike } from '#features/chat/lib/speech-recognition.ts';

export const getRecognitionMode = fn<() => RecognitionMode>().mockReturnValue('unsupported');
export const createSpeechRecognition = fn<() => SpeechRecognitionLike | null>().mockReturnValue(null);
export const ensureOnDeviceLanguagePack = fn().mockResolvedValue({ ok: false, fallbackToCloud: false });

export function resetSpeechMocks() {
	getRecognitionMode.mockReset().mockReturnValue('unsupported');
	createSpeechRecognition.mockReset().mockReturnValue(null);
	ensureOnDeviceLanguagePack.mockReset().mockResolvedValue({ ok: false, fallbackToCloud: false });
}
