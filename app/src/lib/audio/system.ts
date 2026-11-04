import type { AudioTimeSource } from "@speeedy/engine";
import { fillNoise, type NoiseKind } from "./noise.ts";
import {
	AMBIENT_KINDS,
	type AmbientKind,
	type AudioPrefs,
	type BusName,
	clampVolume,
	DEFAULT_AUDIO_PREFS,
	loadAudioPrefs,
	saveAudioPrefs,
} from "./prefs.ts";

/** The slice of the Web Audio API the AudioSystem uses. A fake stands in for it in tests. */
export interface AudioParamLike {
	value: number;
	setValueAtTime(value: number, time: number): unknown;
	linearRampToValueAtTime(value: number, time: number): unknown;
	setTargetAtTime(value: number, time: number, timeConstant: number): unknown;
	cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
	connect(destination: AudioNodeLike): unknown;
	disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
	readonly gain: AudioParamLike;
}

export interface BufferLike {
	getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends AudioNodeLike {
	buffer: BufferLike | null;
	loop: boolean;
	onended?: (() => void) | null;
	start(time?: number): void;
	stop(time?: number): void;
}

export interface OscillatorLike extends AudioNodeLike {
	type: string;
	readonly frequency: AudioParamLike;
	onended?: (() => void) | null;
	start(time?: number): void;
	stop(time?: number): void;
}

export interface AudioContextLike extends AudioTimeSource {
	readonly state: string;
	readonly sampleRate: number;
	readonly destination: AudioNodeLike;
	createGain(): GainNodeLike;
	createBufferSource(): BufferSourceLike;
	createOscillator(): OscillatorLike;
	createBuffer(
		channels: number,
		length: number,
		sampleRate: number,
	): BufferLike;
	resume(): Promise<void>;
	close(): Promise<void>;
	addEventListener(type: "statechange", listener: () => void): void;
	removeEventListener(type: "statechange", listener: () => void): void;
}

/** What `arm` listens on: the window, or anything with the same two methods. */
export type EventTargetLike = Pick<
	EventTarget,
	"addEventListener" | "removeEventListener"
>;

/** How far the ambient bed drops under a voice (a gain, 1 is no drop). */
export const DUCK_LEVEL = 0.25;
/** How long the bed stays down after the voice stops, so the gap between sentences does not pump. */
export const DUCK_HOLD_S = 0.6;
const DUCK_ATTACK_TC = 0.05;
const DUCK_RELEASE_TC = 0.3;

const FADE_IN_S = 0.4;
const FADE_OUT_S = 0.5;
/** A volume change glides over a few time constants of this, so it makes no zipper noise. */
const VOLUME_TC = 0.02;
/** Seconds of noise generated once per kind and looped. */
const NOISE_SECONDS = 6;

const TICK_HZ = 880;
const TICK_ATTACK_S = 0.002;
const TICK_LENGTH_S = 0.014;

/** The gain for a volume: squared, so the slider follows how loudness is heard, not the signal. */
export const gainFor = (volume: number): number => volume * volume;

const GESTURES = ["pointerup", "touchend", "keydown", "click"] as const;
const WAKES = ["pageshow", "focus", "visibilitychange"] as const;

export type AudioState = "locked" | "suspended" | "running";

export type AudioSystemOptions = {
	/** Make the AudioContext. Called at most once at a time, and only from `unlock`. */
	createContext: () => AudioContextLike;
	/** Where the device-only preferences live. Without it they last for the visit. */
	storage?: Pick<Storage, "getItem" | "setItem"> | undefined;
	/**
	 * Whether the page has had a user gesture, without which the browser refuses to start a
	 * context. Where the browser cannot say, the answer is yes.
	 */
	hasUserActivation?: () => boolean;
};

export interface AudioSystem {
	/** The one AudioContext, or nothing until a gesture unlocked it. The audio Clock reads this. */
	readonly context: AudioContextLike | undefined;
	/** `locked` before there is a context, then `running`, or `suspended` when the browser stopped it. */
	readonly state: AudioState;
	/** Where a sound plays into: the inputs of the three buses. Nothing until unlocked. */
	readonly buses: Readonly<Record<BusName, AudioNodeLike>> | undefined;
	readonly prefs: AudioPrefs;
	/**
	 * Make the context if it is not there and start it. Call it from a gesture's handler: the
	 * context is made before the first await, which is what the browsers' autoplay rules want.
	 * Resolves to whether the context is running.
	 */
	unlock(): Promise<boolean>;
	/**
	 * Listen on the page for the gestures that unlock sound once it is wanted (an ambient
	 * choice or the tick), and for the page coming back (focus, pageshow, visibility), which
	 * restarts a context the system stopped. Returns a function that stops listening.
	 */
	arm(target: EventTargetLike): () => void;
	setVolume(bus: BusName, volume: number): void;
	setAmbient(kind: AmbientKind): void;
	setTick(on: boolean): void;
	/** The reader is reading: the ambient noise plays while this is true. */
	setReading(reading: boolean): void;
	/** A voice is speaking: the ambient bed ducks under it. */
	setVoiceActive(active: boolean): void;
	/** A short blip on the cue bus. Silent while the context is not running. */
	tick(): void;
	/** Called when the state or the preferences change. */
	subscribe(listener: () => void): () => void;
	/** Stop everything, close the context and let go of the page. */
	dispose(): void;
}

type Bed = { kind: NoiseKind; source: BufferSourceLike; fade: GainNodeLike };

type Graph = {
	context: AudioContextLike;
	master: GainNodeLike;
	buses: Record<BusName, GainNodeLike>;
	/** The ambient bed's ducking gain, before its bus. */
	duck: GainNodeLike;
	noise: Map<NoiseKind, BufferLike>;
	bed: Bed | undefined;
	onState: () => void;
};

const defaultActivation = (): boolean => {
	const activation =
		typeof navigator === "undefined"
			? undefined
			: (navigator as { userActivation?: { hasBeenActive: boolean } })
					.userActivation;
	return activation ? activation.hasBeenActive : true;
};

/**
 * The one owner of the page's AudioContext. Voice, ambient noise and cues are three buses
 * into one master, each with its own volume; the ambient bus also runs through a ducking
 * gain that drops under any voice, always. Nothing is made until a gesture unlocks the
 * context, and nothing touches the network: the noise is generated here, once per kind.
 *
 * Browser voices (Web Speech) cannot be routed through Web Audio, so a voice tells the
 * system when it is speaking (`setVoiceActive`) and ducking follows that. A voice that
 * makes its own audio plays into `buses.voice` and says the same.
 */
export function createAudioSystem(options: AudioSystemOptions): AudioSystem {
	const hasUserActivation = options.hasUserActivation ?? defaultActivation;
	let prefs = loadAudioPrefs(options.storage);
	let graph: Graph | undefined;
	let reading = false;
	let voiceActive = false;
	let disposed = false;
	const subscribers = new Set<() => void>();
	const disarms = new Set<() => void>();

	const notify = () => {
		for (const subscriber of [...subscribers]) subscriber();
	};

	const wanted = () => prefs.ambient !== "none" || prefs.tick;

	function dropGraph(current: Graph) {
		current.context.removeEventListener("statechange", current.onState);
		if (graph === current) graph = undefined;
	}

	function buildGraph(context: AudioContextLike): Graph {
		const master = context.createGain();
		master.connect(context.destination);
		const bus = (name: BusName) => {
			const node = context.createGain();
			node.gain.value = gainFor(prefs.volumes[name]);
			node.connect(master);
			return node;
		};
		const buses = {
			voice: bus("voice"),
			ambient: bus("ambient"),
			cue: bus("cue"),
		};
		const duck = context.createGain();
		if (voiceActive) duck.gain.value = DUCK_LEVEL;
		duck.connect(buses.ambient);
		const made: Graph = {
			context,
			master,
			buses,
			duck,
			noise: new Map(),
			bed: undefined,
			onState: () => {
				// A closed context cannot be started again: the next unlock makes a new one.
				if (context.state === "closed") dropGraph(made);
				notify();
			},
		};
		context.addEventListener("statechange", made.onState);
		return made;
	}

	function ensureGraph(): Graph | undefined {
		if (disposed) return undefined;
		if (graph && graph.context.state !== "closed") return graph;
		if (graph) dropGraph(graph);
		let context: AudioContextLike;
		try {
			context = options.createContext();
		} catch {
			// A browser without Web Audio: there is no sound, and nothing else breaks.
			return undefined;
		}
		graph = buildGraph(context);
		syncAmbient();
		notify();
		return graph;
	}

	async function start(current: Graph): Promise<boolean> {
		if (current.context.state === "running") return true;
		try {
			await current.context.resume();
		} catch {
			return false;
		}
		return current.context.state === "running";
	}

	function unlock(): Promise<boolean> {
		const current = ensureGraph();
		return current ? start(current) : Promise.resolve(false);
	}

	/** Try to have a context if the reader reads and wants sound, without breaking autoplay rules. */
	function kickoff() {
		if (!reading || !wanted() || disposed) return;
		if (graph || hasUserActivation()) void unlock();
	}

	function noiseBuffer(current: Graph, kind: NoiseKind): BufferLike {
		const cached = current.noise.get(kind);
		if (cached) return cached;
		const { context } = current;
		const buffer = context.createBuffer(
			1,
			Math.round(context.sampleRate * NOISE_SECONDS),
			context.sampleRate,
		);
		fillNoise(kind, buffer.getChannelData(0));
		current.noise.set(kind, buffer);
		return buffer;
	}

	function fadeOut(current: Graph, bed: Bed, immediately = false) {
		const now = current.context.currentTime;
		const { fade, source } = bed;
		fade.gain.cancelScheduledValues(now);
		fade.gain.setValueAtTime(fade.gain.value, now);
		fade.gain.linearRampToValueAtTime(0, now + FADE_OUT_S);
		try {
			source.stop(immediately ? now : now + FADE_OUT_S + 0.05);
		} catch {
			// Already stopped.
		}
		source.onended = () => {
			source.disconnect();
			fade.disconnect();
		};
	}

	function syncAmbient() {
		const current = graph;
		if (!current) return;
		const wantedKind: NoiseKind | undefined =
			reading && prefs.ambient !== "none" ? prefs.ambient : undefined;
		if (current.bed?.kind === wantedKind) return;
		if (current.bed) {
			fadeOut(current, current.bed);
			current.bed = undefined;
		}
		if (!wantedKind) return;
		const now = current.context.currentTime;
		const source = current.context.createBufferSource();
		source.buffer = noiseBuffer(current, wantedKind);
		source.loop = true;
		const fade = current.context.createGain();
		fade.gain.setValueAtTime(0, now);
		fade.gain.linearRampToValueAtTime(1, now + FADE_IN_S);
		source.connect(fade);
		fade.connect(current.duck);
		source.start(now);
		current.bed = { kind: wantedKind, source, fade };
	}

	function applyDuck() {
		const current = graph;
		if (!current) return;
		const { gain } = current.duck;
		const now = current.context.currentTime;
		gain.cancelScheduledValues(now);
		if (voiceActive) gain.setTargetAtTime(DUCK_LEVEL, now, DUCK_ATTACK_TC);
		else gain.setTargetAtTime(1, now + DUCK_HOLD_S, DUCK_RELEASE_TC);
	}

	function change(next: AudioPrefs) {
		prefs = next;
		saveAudioPrefs(options.storage, prefs);
		notify();
	}

	return {
		get context() {
			return graph?.context;
		},
		get state() {
			if (!graph) return "locked";
			return graph.context.state === "running" ? "running" : "suspended";
		},
		get buses() {
			return graph ? graph.buses : undefined;
		},
		get prefs() {
			return prefs;
		},
		unlock,
		arm(target) {
			const onGesture = () => {
				if (graph && graph.context.state !== "running") void start(graph);
				else if (!graph && wanted()) void unlock();
			};
			const onWake = () => {
				if (graph && graph.context.state !== "running") void start(graph);
			};
			for (const type of GESTURES) target.addEventListener(type, onGesture);
			for (const type of WAKES) target.addEventListener(type, onWake);
			const disarm = () => {
				for (const type of GESTURES)
					target.removeEventListener(type, onGesture);
				for (const type of WAKES) target.removeEventListener(type, onWake);
				disarms.delete(disarm);
			};
			disarms.add(disarm);
			return disarm;
		},
		setVolume(bus, volume) {
			const next = clampVolume(volume, DEFAULT_AUDIO_PREFS.volumes[bus]);
			change({ ...prefs, volumes: { ...prefs.volumes, [bus]: next } });
			if (graph) {
				graph.buses[bus].gain.setTargetAtTime(
					gainFor(next),
					graph.context.currentTime,
					VOLUME_TC,
				);
			}
		},
		setAmbient(kind) {
			if (!AMBIENT_KINDS.includes(kind) || kind === prefs.ambient) return;
			change({ ...prefs, ambient: kind });
			kickoff();
			syncAmbient();
		},
		setTick(on) {
			if (on === prefs.tick) return;
			change({ ...prefs, tick: on });
			kickoff();
		},
		setReading(next) {
			reading = next;
			kickoff();
			syncAmbient();
		},
		setVoiceActive(active) {
			if (active === voiceActive) return;
			voiceActive = active;
			applyDuck();
		},
		tick() {
			const current = graph;
			if (current?.context.state !== "running") return;
			if (prefs.volumes.cue === 0) return;
			const { context } = current;
			const now = context.currentTime;
			const oscillator = context.createOscillator();
			oscillator.type = "sine";
			oscillator.frequency.setValueAtTime(TICK_HZ, now);
			const envelope = context.createGain();
			envelope.gain.setValueAtTime(0, now);
			envelope.gain.linearRampToValueAtTime(1, now + TICK_ATTACK_S);
			envelope.gain.linearRampToValueAtTime(0, now + TICK_LENGTH_S);
			oscillator.connect(envelope);
			envelope.connect(current.buses.cue);
			oscillator.start(now);
			oscillator.stop(now + TICK_LENGTH_S + 0.001);
			oscillator.onended = () => {
				oscillator.disconnect();
				envelope.disconnect();
			};
		},
		subscribe(listener) {
			subscribers.add(listener);
			return () => {
				subscribers.delete(listener);
			};
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const disarm of [...disarms]) disarm();
			const current = graph;
			if (current) {
				if (current.bed) fadeOut(current, current.bed, true);
				current.bed = undefined;
				dropGraph(current);
				void current.context.close().catch(() => {});
			}
			subscribers.clear();
		},
	};
}
