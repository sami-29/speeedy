import { describe, expect, it } from "vitest";
import {
	AUDIO_PREFS_KEY,
	DEFAULT_AUDIO_PREFS,
} from "../src/lib/audio/prefs.ts";
import {
	type AudioSystem,
	createAudioSystem,
	DUCK_HOLD_S,
	DUCK_LEVEL,
	gainFor,
} from "../src/lib/audio/system.ts";
import {
	type FakeContext,
	type FakeGain,
	type FakeNode,
	fakeContexts,
	memoryStorage,
} from "./fake-audio.ts";

function setup(
	options: {
		storage?: ReturnType<typeof memoryStorage>;
		/** Whether the page has had a user gesture yet. */
		active?: boolean;
		/** The browser holds every new context back until a gesture. */
		blocked?: boolean;
	} = {},
) {
	const contexts = fakeContexts(options.blocked);
	const storage = options.storage ?? memoryStorage();
	const system = createAudioSystem({
		createContext: contexts.create,
		storage,
		hasUserActivation: () => options.active ?? true,
	});
	return { system, contexts, storage };
}

const gainOf = (node: unknown) => (node as FakeGain).gain;

/** The bus a voice would play into, as the context sees it. */
function buses(system: AudioSystem) {
	const found = system.buses;
	if (!found) throw new Error("the system has no context yet");
	return found as unknown as Record<"voice" | "ambient" | "cue", FakeNode>;
}

/** The nodes a noise source runs through: its fade, the duck, and the ambient bus. */
function chain(context: FakeContext) {
	const source = context.sources[context.sources.length - 1];
	if (!source) throw new Error("no noise source");
	const fade = source.connections[0] as FakeGain;
	const duck = fade.connections[0] as FakeGain;
	const bus = duck.connections[0] as FakeGain;
	return { source, fade, duck, bus };
}

describe("gainFor", () => {
	it("turns a volume into a perceptual gain: silent at 0, full at 1, quieter than linear between", () => {
		expect(gainFor(0)).toBe(0);
		expect(gainFor(1)).toBe(1);
		expect(gainFor(0.5)).toBe(0.25);
	});
});

describe("AudioSystem: one context, started by a gesture", () => {
	it("makes no context until it is unlocked", () => {
		const { system, contexts } = setup();
		system.setAmbient("pink");
		system.tick();
		system.setVoiceActive(true);
		expect(contexts.made).toHaveLength(0);
		expect(system.context).toBeUndefined();
		expect(system.state).toBe("locked");
	});

	it("unlocking makes the one context and resumes it", async () => {
		const { system, contexts } = setup();
		expect(await system.unlock()).toBe(true);
		expect(contexts.made).toHaveLength(1);
		expect(contexts.last.resumes).toBe(1);
		expect(system.context).toBe(contexts.last);
		expect(system.state).toBe("running");
	});

	it("keeps one context however often, and however at once, it is unlocked", async () => {
		const { system, contexts } = setup();
		await Promise.all([system.unlock(), system.unlock(), system.unlock()]);
		await system.unlock();
		expect(contexts.made).toHaveLength(1);
		expect(contexts.last.listenerCount).toBe(1);
	});

	it("makes the context before the first await, so it starts inside the gesture", () => {
		const { system, contexts } = setup();
		void system.unlock();
		expect(contexts.made).toHaveLength(1);
	});

	it("reports a browser that holds the context back, and starts it on the next try", async () => {
		const { system, contexts } = setup({ blocked: true });
		expect(await system.unlock()).toBe(false);
		expect(system.state).toBe("suspended");
		const [context] = contexts.made;
		if (context) context.blocked = false;
		expect(await system.unlock()).toBe(true);
		expect(contexts.made).toHaveLength(1);
		expect(system.state).toBe("running");
	});

	it("tells subscribers when the state changes, including a change the browser makes", async () => {
		const { system, contexts } = setup();
		const seen: string[] = [];
		system.subscribe(() => seen.push(system.state));
		await system.unlock();
		contexts.last.setState("interrupted");
		expect(seen).toContain("running");
		expect(seen[seen.length - 1]).toBe("suspended");
	});

	it("makes a new context when the browser closed the old one", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		const first = contexts.last;
		first.setState("closed");
		expect(system.state).toBe("locked");
		await system.unlock();
		expect(contexts.made).toHaveLength(2);
		expect(system.context).toBe(contexts.last);
		expect(system.context).not.toBe(first);
	});

	it("closes its context and lets go of it when disposed", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		const context = contexts.last;
		system.dispose();
		expect(context.closes).toBe(1);
		expect(context.listenerCount).toBe(0);
		expect(await system.unlock()).toBe(false);
		expect(contexts.made).toHaveLength(1);
	});
});

describe("AudioSystem: the gesture and wake listeners", () => {
	it("unlocks on a gesture only once sound is wanted", async () => {
		const { system, contexts } = setup();
		const page = new EventTarget();
		system.arm(page);
		page.dispatchEvent(new Event("click"));
		expect(contexts.made).toHaveLength(0);
		system.setAmbient("white");
		page.dispatchEvent(new Event("click"));
		expect(contexts.made).toHaveLength(1);
		await system.unlock();
		expect(system.state).toBe("running");
	});

	it("takes a key press, a touch and a pointer release as gestures", () => {
		for (const type of ["keydown", "touchend", "pointerup"]) {
			const { system, contexts } = setup();
			system.setTick(true);
			const page = new EventTarget();
			system.arm(page);
			page.dispatchEvent(new Event(type));
			expect(contexts.made, type).toHaveLength(1);
		}
	});

	it("resumes a suspended context when the page comes back (focus, pageshow, visibility)", async () => {
		for (const type of ["focus", "pageshow", "visibilitychange"]) {
			const { system, contexts } = setup();
			system.setAmbient("pink");
			await system.unlock();
			const page = new EventTarget();
			system.arm(page);
			contexts.last.setState("interrupted");
			const before = contexts.last.resumes;
			page.dispatchEvent(new Event(type));
			expect(contexts.last.resumes, type).toBe(before + 1);
		}
	});

	it("does not make a context when the page wakes and none exists", () => {
		const { system, contexts } = setup();
		system.setAmbient("pink");
		const page = new EventTarget();
		system.arm(page);
		page.dispatchEvent(new Event("focus"));
		expect(contexts.made).toHaveLength(0);
	});

	it("stops listening once disarmed", () => {
		const { system, contexts } = setup();
		system.setAmbient("pink");
		const page = new EventTarget();
		const disarm = system.arm(page);
		disarm();
		page.dispatchEvent(new Event("click"));
		expect(contexts.made).toHaveLength(0);
	});

	it("does not start the context for a page that has had no gesture, but starts it on the first", () => {
		const { system, contexts } = setup({ active: false });
		system.setAmbient("pink");
		system.setReading(true);
		expect(contexts.made).toHaveLength(0);
		const page = new EventTarget();
		system.arm(page);
		page.dispatchEvent(new Event("click"));
		expect(contexts.made).toHaveLength(1);
	});
});

describe("AudioSystem: three buses with their own volumes", () => {
	it("routes the voice, ambient and cue buses to the output through one master", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		const { voice, ambient, cue } = buses(system);
		for (const bus of [voice, ambient, cue]) {
			expect(bus.reaches(contexts.last.destination)).toBe(true);
		}
		expect(new Set([voice, ambient, cue]).size).toBe(3);
	});

	it("sets each bus's volume on its own", async () => {
		const { system } = setup();
		await system.unlock();
		const { voice, ambient, cue } = buses(system);
		system.setVolume("voice", 0.5);
		expect(gainOf(voice).settled).toBe(gainFor(0.5));
		expect(gainOf(ambient).settled).toBe(
			gainFor(DEFAULT_AUDIO_PREFS.volumes.ambient),
		);
		expect(gainOf(cue).settled).toBe(gainFor(DEFAULT_AUDIO_PREFS.volumes.cue));
		system.setVolume("cue", 0);
		expect(gainOf(cue).settled).toBe(0);
		expect(gainOf(voice).settled).toBe(gainFor(0.5));
	});

	it("ramps a volume change instead of jumping, so it makes no click", async () => {
		const { system } = setup();
		await system.unlock();
		system.setVolume("voice", 0.2);
		const last = gainOf(buses(system).voice).scheduled.at(-1);
		expect(last?.type).toBe("target");
	});

	it("applies volumes chosen before the context existed", async () => {
		const { system } = setup();
		system.setVolume("ambient", 0.8);
		await system.unlock();
		expect(gainOf(buses(system).ambient).settled).toBe(gainFor(0.8));
	});

	it("keeps a volume in range", () => {
		const { system } = setup();
		system.setVolume("voice", 7);
		expect(system.prefs.volumes.voice).toBe(1);
		system.setVolume("voice", -2);
		expect(system.prefs.volumes.voice).toBe(0);
		system.setVolume("voice", Number.NaN);
		expect(system.prefs.volumes.voice).toBe(DEFAULT_AUDIO_PREFS.volumes.voice);
	});
});

describe("AudioSystem: ambient noise", () => {
	it("plays the chosen noise while reading, looped, from a buffer it generated", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		system.setAmbient("pink");
		expect(contexts.last.sources).toHaveLength(0);
		system.setReading(true);
		const { source, fade, bus } = chain(contexts.last);
		expect(source.loop).toBe(true);
		expect(source.startedAt).toBeDefined();
		expect(source.buffer?.data.some((sample) => sample !== 0)).toBe(true);
		expect(gainOf(fade).settled).toBe(1);
		expect(bus).toBe(buses(system).ambient);
	});

	it("plays nothing for none, and nothing when the reader is not reading", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		system.setReading(true);
		expect(contexts.last.sources).toHaveLength(0);
		system.setAmbient("brown");
		expect(contexts.last.sources).toHaveLength(1);
		system.setReading(false);
		const { source, fade } = chain(contexts.last);
		expect(gainOf(fade).settled).toBe(0);
		expect(source.stoppedAt).toBeGreaterThan(contexts.last.currentTime);
	});

	it("fades the old noise out and the new one in when the choice changes", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		system.setAmbient("white");
		system.setReading(true);
		const first = chain(contexts.last);
		system.setAmbient("brown");
		expect(contexts.last.sources).toHaveLength(2);
		expect(gainOf(first.fade).settled).toBe(0);
		expect(first.source.stoppedAt).toBeGreaterThan(contexts.last.currentTime);
		const second = chain(contexts.last);
		expect(second.source).not.toBe(first.source);
		expect(gainOf(second.fade).settled).toBe(1);
	});

	it("stops the noise when the choice goes back to none", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		system.setAmbient("white");
		system.setReading(true);
		system.setAmbient("none");
		const { source, fade } = chain(contexts.last);
		expect(gainOf(fade).settled).toBe(0);
		expect(source.stoppedAt).toBeDefined();
	});

	it("generates each kind of noise once and reuses it", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		system.setAmbient("pink");
		system.setReading(true);
		system.setReading(false);
		system.setReading(true);
		system.setAmbient("white");
		system.setAmbient("pink");
		expect(contexts.last.buffers).toHaveLength(2);
		expect(contexts.last.sources[0]?.buffer).toBe(
			contexts.last.sources[3]?.buffer,
		);
	});

	it("does not start the same noise twice", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		system.setAmbient("pink");
		system.setReading(true);
		system.setReading(true);
		system.setAmbient("pink");
		expect(contexts.last.sources).toHaveLength(1);
	});

	it("starts the noise reading asked for when the context unlocks, inside the same gesture", () => {
		const { system, contexts } = setup();
		system.setAmbient("brown");
		system.setReading(true);
		expect(contexts.made).toHaveLength(1);
		expect(contexts.last.sources).toHaveLength(1);
	});

	it("starts the noise again on a new context after the old one was closed", async () => {
		const { system, contexts } = setup();
		system.setAmbient("pink");
		system.setReading(true);
		await system.unlock();
		contexts.last.setState("closed");
		await system.unlock();
		expect(contexts.made).toHaveLength(2);
		expect(contexts.last.sources).toHaveLength(1);
	});

	it("stops its noise and leaves nothing playing when disposed", async () => {
		const { system, contexts } = setup();
		system.setAmbient("pink");
		system.setReading(true);
		await system.unlock();
		system.dispose();
		const stopped = contexts.last.sources.every(
			(source) => source.stoppedAt !== undefined,
		);
		expect(stopped).toBe(true);
	});
});

describe("AudioSystem: ducking", () => {
	async function playing() {
		const rig = setup();
		await rig.system.unlock();
		rig.system.setAmbient("pink");
		rig.system.setReading(true);
		return { ...rig, ...chain(rig.contexts.last) };
	}

	it("starts at full level with no voice", async () => {
		const { duck } = await playing();
		expect(duck.gain.settled).toBe(1);
	});

	it("drops the ambient bus under the voice, smoothly and at once", async () => {
		const { system, duck, contexts } = await playing();
		system.setVoiceActive(true);
		expect(duck.gain.settled).toBe(DUCK_LEVEL);
		expect(DUCK_LEVEL).toBeLessThan(0.5);
		const last = duck.gain.scheduled.at(-1);
		expect(last?.type).toBe("target");
		expect(last?.time).toBe(contexts.last.currentTime);
	});

	it("brings it back after a hold, so the gap between sentences does not pump", async () => {
		const { system, duck, contexts } = await playing();
		contexts.last.currentTime = 10;
		system.setVoiceActive(true);
		system.setVoiceActive(false);
		const last = duck.gain.scheduled.at(-1);
		expect(last?.value).toBe(1);
		expect(last?.time).toBe(10 + DUCK_HOLD_S);
	});

	it("keeps ducking when the voice returns within the hold", async () => {
		const { system, duck } = await playing();
		system.setVoiceActive(true);
		system.setVoiceActive(false);
		system.setVoiceActive(true);
		expect(
			duck.gain.scheduled.some(
				(event) => event.value === 1 && event.type === "target",
			),
		).toBe(false);
		expect(duck.gain.settled).toBe(DUCK_LEVEL);
	});

	it("is on whichever noise plays, and whatever the ambient volume", async () => {
		const { system, contexts } = await playing();
		system.setVoiceActive(true);
		system.setAmbient("white");
		system.setVolume("ambient", 1);
		expect(chain(contexts.last).duck.gain.settled).toBe(DUCK_LEVEL);
	});

	it("starts ducked when the voice was already speaking as the context unlocked", () => {
		const { system, contexts } = setup();
		system.setAmbient("pink");
		system.setReading(true);
		system.setVoiceActive(true);
		expect(chain(contexts.last).duck.gain.settled).toBe(DUCK_LEVEL);
	});
});

describe("AudioSystem: the per-word tick", () => {
	it("plays a short blip into the cue bus", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		contexts.last.currentTime = 4;
		system.tick();
		const [oscillator] = contexts.last.oscillators;
		expect(oscillator).toBeDefined();
		expect(oscillator?.startedAt).toBeGreaterThanOrEqual(4);
		expect(
			(oscillator?.stoppedAt ?? 0) - (oscillator?.startedAt ?? 0),
		).toBeLessThan(0.05);
		const envelope = oscillator?.connections[0] as FakeGain;
		expect(
			envelope.reaches(buses(system).cue) ||
				envelope.connections.includes(buses(system).cue),
		).toBe(true);
	});

	it("is silent when the context has not started or is suspended", async () => {
		const { system, contexts } = setup();
		system.tick();
		await system.unlock();
		contexts.last.setState("interrupted");
		system.tick();
		expect(contexts.last.oscillators).toHaveLength(0);
	});

	it("is quiet when the cue volume is zero", async () => {
		const { system, contexts } = setup();
		await system.unlock();
		system.setVolume("cue", 0);
		system.tick();
		expect(contexts.last.oscillators).toHaveLength(0);
	});
});

describe("AudioSystem: device-only settings", () => {
	it("keeps the volumes, the ambient choice and the tick on this device", () => {
		const { system, storage } = setup();
		system.setVolume("voice", 0.4);
		system.setVolume("ambient", 0.6);
		system.setAmbient("brown");
		system.setTick(true);
		const raw = storage.data.get(AUDIO_PREFS_KEY);
		expect(JSON.parse(raw ?? "{}")).toEqual({
			volumes: {
				voice: 0.4,
				ambient: 0.6,
				cue: DEFAULT_AUDIO_PREFS.volumes.cue,
			},
			ambient: "brown",
			tick: true,
		});
		const again = setup({ storage });
		expect(again.system.prefs).toEqual({
			volumes: {
				voice: 0.4,
				ambient: 0.6,
				cue: DEFAULT_AUDIO_PREFS.volumes.cue,
			},
			ambient: "brown",
			tick: true,
		});
	});

	it("tells subscribers when a setting changes", () => {
		const { system } = setup();
		let calls = 0;
		const stop = system.subscribe(() => calls++);
		system.setAmbient("white");
		expect(calls).toBeGreaterThan(0);
		stop();
		const before = calls;
		system.setTick(true);
		expect(calls).toBe(before);
	});
});
