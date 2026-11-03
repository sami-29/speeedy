import type { LauncherPage } from "@speeedy/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DeliverEnv, deliverPage, type Peer } from "../src/deliver.ts";

const TARGET = "https://speeedy.app";

type Incoming = { data: unknown; origin: string; source: unknown };

const page: LauncherPage = {
	type: "speeedy:page",
	version: 1,
	title: "Title",
	url: "https://news.example/a",
	language: "en",
	document: {
		version: 1,
		blocks: [{ kind: "paragraph", text: "Hi.", spans: [] }],
	},
};

function setup(options: { blocked?: boolean } = {}) {
	const listeners = new Set<(event: Incoming) => void>();
	const posted: Array<{ message: unknown; targetOrigin: string }> = [];
	const child: Peer = {
		postMessage: (message, targetOrigin) =>
			posted.push({ message, targetOrigin }),
	};
	let opened = 0;
	const env: DeliverEnv = {
		open: () => {
			opened++;
			return options.blocked ? null : child;
		},
		addEventListener: (_type, listener) => listeners.add(listener),
		removeEventListener: (_type, listener) => listeners.delete(listener),
	};
	const send = (event: Incoming) => {
		for (const listener of [...listeners]) listener(event);
	};
	return { env, child, posted, send, opened: () => opened, listeners };
}

const ready = { type: "speeedy:ready", version: 1 };
const ack = (ok: boolean) => ({ type: "speeedy:ack", version: 1, ok });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("deliverPage", () => {
	it("opens Speeedy, waits for ready, posts the page to Speeedy's origin and ends on the ack", async () => {
		const t = setup();
		const outcome = deliverPage({
			env: t.env,
			targetOrigin: TARGET,
			page,
			timeoutMs: 5000,
		});
		expect(t.opened()).toBe(1);
		expect(t.posted).toEqual([]);
		t.send({ data: ready, origin: TARGET, source: t.child });
		expect(t.posted).toEqual([{ message: page, targetOrigin: TARGET }]);
		t.send({ data: ack(true), origin: TARGET, source: t.child });
		await expect(outcome).resolves.toBe("delivered");
		expect(t.listeners.size).toBe(0);
	});

	it("never posts the page with a wildcard target", async () => {
		const t = setup();
		const outcome = deliverPage({
			env: t.env,
			targetOrigin: TARGET,
			page,
			timeoutMs: 5000,
		});
		t.send({ data: ready, origin: TARGET, source: t.child });
		t.send({ data: ack(true), origin: TARGET, source: t.child });
		await outcome;
		expect(t.posted.every((entry) => entry.targetOrigin !== "*")).toBe(true);
	});

	it("reports a refusal when Speeedy acknowledges with ok false", async () => {
		const t = setup();
		const outcome = deliverPage({
			env: t.env,
			targetOrigin: TARGET,
			page,
			timeoutMs: 5000,
		});
		t.send({ data: ready, origin: TARGET, source: t.child });
		t.send({ data: ack(false), origin: TARGET, source: t.child });
		await expect(outcome).resolves.toBe("refused");
	});

	it("does not send the page to a window that is not the one it opened", async () => {
		const t = setup();
		const outcome = deliverPage({
			env: t.env,
			targetOrigin: TARGET,
			page,
			timeoutMs: 5000,
		});
		t.send({ data: ready, origin: TARGET, source: { postMessage() {} } });
		t.send({ data: ready, origin: TARGET, source: null });
		expect(t.posted).toEqual([]);
		vi.advanceTimersByTime(5000);
		await expect(outcome).resolves.toBe("timeout");
	});

	it("does not send the page when ready comes from another origin", async () => {
		const t = setup();
		const outcome = deliverPage({
			env: t.env,
			targetOrigin: TARGET,
			page,
			timeoutMs: 5000,
		});
		t.send({
			data: ready,
			origin: "https://speeedy.app.evil.example",
			source: t.child,
		});
		t.send({ data: ready, origin: "null", source: t.child });
		expect(t.posted).toEqual([]);
		vi.advanceTimersByTime(5000);
		await expect(outcome).resolves.toBe("timeout");
	});

	it("does not take an ack from another origin as the answer", async () => {
		const t = setup();
		const outcome = deliverPage({
			env: t.env,
			targetOrigin: TARGET,
			page,
			timeoutMs: 5000,
		});
		t.send({ data: ready, origin: TARGET, source: t.child });
		t.send({
			data: ack(true),
			origin: "https://evil.example",
			source: t.child,
		});
		vi.advanceTimersByTime(5000);
		await expect(outcome).resolves.toBe("timeout");
	});

	it("posts the page once even when ready arrives twice", async () => {
		const t = setup();
		const outcome = deliverPage({
			env: t.env,
			targetOrigin: TARGET,
			page,
			timeoutMs: 5000,
		});
		t.send({ data: ready, origin: TARGET, source: t.child });
		t.send({ data: ready, origin: TARGET, source: t.child });
		expect(t.posted).toHaveLength(1);
		t.send({ data: ack(true), origin: TARGET, source: t.child });
		await outcome;
	});

	it("says blocked when the browser would not open the tab", async () => {
		const t = setup({ blocked: true });
		await expect(
			deliverPage({ env: t.env, targetOrigin: TARGET, page, timeoutMs: 5000 }),
		).resolves.toBe("blocked");
		expect(t.listeners.size).toBe(0);
	});

	it("times out when Speeedy never answers, and stops listening", async () => {
		const t = setup();
		const outcome = deliverPage({
			env: t.env,
			targetOrigin: TARGET,
			page,
			timeoutMs: 5000,
		});
		vi.advanceTimersByTime(5000);
		await expect(outcome).resolves.toBe("timeout");
		expect(t.listeners.size).toBe(0);
	});
});
