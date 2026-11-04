import type { Engine } from "@speeedy/engine";
import type { AudioSystem, EventTargetLike } from "./system.ts";

/** The part of the AudioSystem the reading sound drives. */
export type ReadingAudio = Pick<
	AudioSystem,
	"setReading" | "setVoiceActive" | "tick" | "arm"
> & { readonly prefs: Pick<AudioSystem["prefs"], "tick"> };

export type ReadingSoundOptions = {
	engine: Engine;
	audio: ReadingAudio;
	/**
	 * Whether the open Reading Mode makes no sound of its own (RSVP, Pacer). Asked each time,
	 * so a switch of mode is followed. A mode that is not silent has a voice: the ambient bed
	 * ducks under it and there is no tick.
	 */
	silent: () => boolean;
	/** The page, for the gestures that unlock sound. */
	page: EventTargetLike;
};

/**
 * Ties the AudioSystem to one reading. The ambient bed plays while the Engine plays, in any
 * mode. In a silent mode each Frame shown ticks, if the reader asked for it. In a mode with a
 * voice the bed ducks while the Engine plays. Returns a function that silences it all.
 */
export function attachReadingSound({
	engine,
	audio,
	silent,
	page,
}: ReadingSoundOptions): () => void {
	const disarm = audio.arm(page);
	const stopped = () => {
		audio.setReading(false);
		audio.setVoiceActive(false);
	};
	const stops = [
		engine.on("play", () => {
			audio.setReading(true);
			if (!silent()) audio.setVoiceActive(true);
		}),
		engine.on("pause", stopped),
		engine.on("end", stopped),
		engine.on("frameShown", () => {
			if (engine.playing && silent() && audio.prefs.tick) audio.tick();
		}),
	];
	return () => {
		for (const stop of stops) stop();
		disarm();
		stopped();
	};
}
