import { describe, expect, it } from "vitest";
import {
	SKIP_WAITING,
	type WorkerLike,
	watchForUpdate,
} from "../src/lib/pwa/update.ts";

type Listener = () => void;

function fakeWorker(state: string): WorkerLike & {
	sent: unknown[];
	set(state: string): void;
} {
	const listeners: Listener[] = [];
	const worker = {
		state,
		sent: [] as unknown[],
		postMessage(message: unknown) {
			worker.sent.push(message);
		},
		addEventListener(_: "statechange", fn: Listener) {
			listeners.push(fn);
		},
		set(next: string) {
			worker.state = next;
			for (const fn of listeners) fn();
		},
	};
	return worker;
}

function fakeContainer(options: { controlled: boolean }) {
	const regListeners: Listener[] = [];
	const containerListeners: Listener[] = [];
	const registration = {
		waiting: null as ReturnType<typeof fakeWorker> | null,
		installing: null as ReturnType<typeof fakeWorker> | null,
		updates: 0,
		update: async () => {
			registration.updates++;
		},
		addEventListener(_: "updatefound", fn: Listener) {
			regListeners.push(fn);
		},
		found(worker: ReturnType<typeof fakeWorker>) {
			registration.installing = worker;
			for (const fn of regListeners) fn();
		},
	};
	const container = {
		controller: options.controlled ? ({} as object) : null,
		ready: Promise.resolve(registration),
		addEventListener(_: "controllerchange", fn: Listener) {
			containerListeners.push(fn);
		},
		removeEventListener() {},
		takeControl() {
			for (const fn of containerListeners) fn();
		},
	};
	return { container, registration };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("watchForUpdate", () => {
	it("reports an update already waiting when the page opens", async () => {
		const { container, registration } = fakeContainer({ controlled: true });
		registration.waiting = fakeWorker("installed");
		const states: boolean[] = [];
		watchForUpdate(container, { onChange: (ready) => states.push(ready) });
		await settle();
		expect(states.at(-1)).toBe(true);
	});

	it("reports an update that finishes installing while the page is open", async () => {
		const { container, registration } = fakeContainer({ controlled: true });
		const states: boolean[] = [];
		watchForUpdate(container, { onChange: (ready) => states.push(ready) });
		await settle();
		expect(states.at(-1) ?? false).toBe(false);
		const worker = fakeWorker("installing");
		registration.found(worker);
		registration.waiting = worker;
		worker.set("installed");
		expect(states.at(-1)).toBe(true);
	});

	it("does not call the very first install an update", async () => {
		const { container, registration } = fakeContainer({ controlled: false });
		const states: boolean[] = [];
		watchForUpdate(container, { onChange: (ready) => states.push(ready) });
		await settle();
		const worker = fakeWorker("installing");
		registration.found(worker);
		worker.set("installed");
		expect(states.some(Boolean)).toBe(false);
	});

	it("tells the waiting worker to take over, then reloads once it has", async () => {
		const { container, registration } = fakeContainer({ controlled: true });
		const waiting = fakeWorker("installed");
		registration.waiting = waiting;
		let reloads = 0;
		const watcher = watchForUpdate(container, {
			onChange: () => {},
			reload: () => reloads++,
		});
		await settle();
		watcher.apply();
		expect(waiting.sent).toEqual([{ type: SKIP_WAITING }]);
		expect(reloads).toBe(0);
		container.takeControl();
		container.takeControl();
		expect(reloads).toBe(1);
	});

	it("does not reload for a takeover the reader did not ask for", async () => {
		const { container } = fakeContainer({ controlled: true });
		let reloads = 0;
		watchForUpdate(container, { onChange: () => {}, reload: () => reloads++ });
		await settle();
		container.takeControl();
		expect(reloads).toBe(0);
	});

	it("checks for a newer worker when asked", async () => {
		const { container, registration } = fakeContainer({ controlled: true });
		const watcher = watchForUpdate(container, { onChange: () => {} });
		await settle();
		await watcher.check();
		expect(registration.updates).toBe(1);
	});
});
