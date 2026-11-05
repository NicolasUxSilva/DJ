import { engine } from '../audio/AudioEngine';
import { KeyboardController } from './KeyboardController';

/** App-wide singletons: the audio engine and the keyboard controller driving it. */
export { engine };
export const keyboard = new KeyboardController(engine);
