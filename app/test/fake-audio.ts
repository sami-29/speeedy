import type {
	AudioContextLike,
	AudioNodeLike,
	AudioParamLike,
} from "../src/lib/audio/system.ts";

type ParamEvent = {
	type: "set" | "ramp" | "target" | "cancel";
	value: number;
	time: number;
	timeConstant?: number;
};

/** An AudioParam that remembers what it was told, so a test can read where it ended up. */
export class FakeParam implements AudioParamLike {
	events: ParamEvent[] = [];
	private current: number;
	constructor(initial: number) {
		this.current = initial;
	}
	get value() {
		return this.current;
	}
	set value(next: number) {
		this.current = next;
		this.events.push({ type: "set", value: next, time: 0 });
	}
	setValueAtTime(value: number, time: number) {
		this.events.push({ type: "set", value, time });
		return this;
	}
	linearRampToValueAtTime(value: number, time: number) {
		this.events.push({ type: "ramp", value, time });
		return this;
	}
	setTargetAtTime(value: number, time: number, timeConstant: number) {
		this.events.push({ type: "target", value, time, timeConstant });
		return this;
	}
	cancelScheduledValues(time: number) {
		this.events = this.events.filter(
			(event) => event.type === "cancel" || event.time < time,
		);
		this.events.push({ type: "cancel", value: 0, time });
		return this;
	}
	/** The value the param is heading for once everything scheduled has played. */
	get settled(): number {
		for (let i = this.events.length - 1; i >= 0; i--) {
			const event = this.events[i];
			if (event && event.type !== "cancel") return event.value;
		}
		return this.current;
	}
	/** The scheduled events that are still there, cancels left out. */
	get scheduled() {
		return this.events.filter((event) => event.type !== "cancel");
	}
}

export class FakeNode implements AudioNodeLike {
	connections: FakeNode[] = [];
	disconnected = false;
	connect(destination: AudioNodeLike) {
		this.connections.push(destination as FakeNode);
		return destination;
	}
	disconnect() {
		this.disconnected = true;
		this.connections = [];
	}
	/** Whether this node reaches `target` through its connections. */
	reaches(target: FakeNode): boolean {
		return this.connections.some(
			(next) => next === target || next.reaches(target),
		);
	}
}

export class FakeGain extends FakeNode {
	gain = new FakeParam(1);
}

export class FakeBuffer {
	data: Float32Array;
	channels: number;
	length: number;
	sampleRate: number;
	constructor(channels: number, length: number, sampleRate: number) {
		this.channels = channels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.data = new Float32Array(length);
	}
	getChannelData() {
		return this.data;
	}
}

export class FakeSource extends FakeNode {
	buffer: FakeBuffer | null = null;
	loop = false;
	startedAt: number | undefined;
	stoppedAt: number | undefined;
	onended: (() => void) | null = null;
	ended = false;
	start(time = 0) {
		this.startedAt = time;
	}
	stop(time = 0) {
		this.stoppedAt = time;
	}
	/** The buffer has played to its end: the browser fires `ended`. */
	end() {
		this.ended = true;
		this.onended?.();
	}
}

export class FakeOscillator extends FakeNode {
	type = "sine";
	frequency = new FakeParam(440);
	startedAt: number | undefined;
	stoppedAt: number | undefined;
	start(time = 0) {
		this.startedAt = time;
	}
	stop(time = 0) {
		this.stoppedAt = time;
	}
}

/** The slice of AudioContext the AudioSystem uses, with controls for what a browser does to it. */
export class FakeContext implements AudioContextLike {
	currentTime = 0;
	sampleRate = 48_000;
	outputLatency: number | undefined = 0.02;
	state: "suspended" | "running" | "closed" | "interrupted" = "suspended";
	destination = new FakeNode();
	gains: FakeGain[] = [];
	sources: FakeSource[] = [];
	oscillators: FakeOscillator[] = [];
	buffers: FakeBuffer[] = [];
	resumes = 0;
	closes = 0;
	/** The browser refuses to start the context (no user gesture yet). */
	blocked = false;
	private listeners = new Set<() => void>();

	createGain() {
		const gain = new FakeGain();
		this.gains.push(gain);
		return gain;
	}
	createBufferSource() {
		const source = new FakeSource();
		this.sources.push(source);
		return source;
	}
	createOscillator() {
		const oscillator = new FakeOscillator();
		this.oscillators.push(oscillator);
		return oscillator;
	}
	createBuffer(channels: number, length: number, sampleRate: number) {
		const buffer = new FakeBuffer(channels, length, sampleRate);
		this.buffers.push(buffer);
		return buffer;
	}
	async resume() {
		this.resumes++;
		if (this.state === "closed") throw new Error("closed");
		if (this.blocked) return;
		this.setState("running");
	}
	async close() {
		this.closes++;
		this.setState("closed");
	}
	addEventListener(_type: "statechange", listener: () => void) {
		this.listeners.add(listener);
	}
	removeEventListener(_type: "statechange", listener: () => void) {
		this.listeners.delete(listener);
	}
	/** The browser suspends or interrupts the context (a call, a locked screen). */
	setState(state: FakeContext["state"]) {
		this.state = state;
		for (const listener of [...this.listeners]) listener();
	}
	get listenerCount() {
		return this.listeners.size;
	}
}

/** Contexts a system made, newest last. */
export function fakeContexts(blocked = false) {
	const made: FakeContext[] = [];
	return {
		made,
		create: () => {
			const context = new FakeContext();
			context.blocked = blocked;
			made.push(context);
			return context;
		},
		get last() {
			return made[made.length - 1] as FakeContext;
		},
	};
}

export function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		data,
	};
}
