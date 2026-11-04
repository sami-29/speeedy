import {
	type AudioContextLike,
	type AudioSystem,
	createAudioSystem,
} from "./system.ts";

let instance: AudioSystem | undefined;

function browserContext(): AudioContextLike {
	const w = window as unknown as {
		AudioContext?: new () => unknown;
		webkitAudioContext?: new () => unknown;
	};
	const Context = w.AudioContext ?? w.webkitAudioContext;
	if (!Context) throw new Error("This browser has no Web Audio.");
	return new Context() as AudioContextLike;
}

function deviceStorage(): Storage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/**
 * The one AudioSystem of this page, and so the one AudioContext. Made on first use, in the
 * browser only; the context itself waits for a gesture.
 */
export function audio(): AudioSystem {
	instance ??= createAudioSystem({
		createContext: browserContext,
		storage: deviceStorage(),
	});
	return instance;
}
