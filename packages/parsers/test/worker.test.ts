import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	attachParserWorker,
	createParserClient,
	type ParserClient,
	parse,
	parseText,
} from "../src/index";
import { expectError, expectSuccess, expectWellFormed, utf8 } from "./helpers";

/**
 * Vitest has no Web Worker, so the boundary is tested through a real structured-clone
 * message channel: `port1` stands in for the worker's global scope and `port2` for the
 * page's `Worker` object. Messages are cloned and buffers transferred exactly as they
 * would be across a real worker.
 */
let channel: MessageChannel;
let detach: () => void;
let client: ParserClient;

beforeEach(() => {
	channel = new MessageChannel();
	detach = attachParserWorker(channel.port1 as never);
	client = createParserClient(channel.port2 as never);
});

afterEach(() => {
	client.dispose();
	detach();
	channel.port1.close();
	channel.port2.close();
});

describe("parse through the worker boundary", () => {
	it("returns exactly what a direct call returns", async () => {
		const cases: [Uint8Array, string, Parameters<typeof parse>[2]?][] = [
			[utf8("Hello world.\n\nSecond one."), "a.txt"],
			[
				utf8("# Title\n\nSome *emphasis* and a [link](https://example.com)."),
				"a.md",
			],
			[utf8('a,"b,c"\n1,2'), "a.csv"],
			[Uint8Array.of(0xfd, 0xfe), "a.txt", { encoding: "windows-1254" }],
			[new Uint8Array(0), "a.txt"],
			[Uint8Array.of(0xbf, 0xf3, 0xb3), "a.txt"],
			[utf8("x"), "photo.png"],
		];
		for (const [bytes, name, hints] of cases) {
			const direct = await parse(bytes.slice(), name, hints);
			const viaWorker = await client.parse(bytes.slice(), name, hints);
			expect(viaWorker, name).toEqual(direct);
			expectWellFormed(viaWorker);
		}
	});

	it("parses pasted text through the worker", async () => {
		const direct = await parseText("One.\n\nTwo.");
		expect(await client.parseText("One.\n\nTwo.")).toEqual(direct);
		expectError(await client.parseText("  "), "empty");
	});

	it("keeps concurrent requests apart", async () => {
		const results = await Promise.all(
			Array.from({ length: 25 }, (_, i) =>
				client.parse(utf8(`Paragraph number ${i}.`), `file${i}.txt`),
			),
		);
		results.forEach((outcome, i) => {
			const result = expectSuccess(outcome);
			expect(result.title).toBe(`file${i}`);
			expect(result.document.blocks[0]).toMatchObject({
				text: `Paragraph number ${i}.`,
			});
		});
	});

	it("takes ownership of a whole buffer it is given, so a big file is not copied", async () => {
		const bytes = utf8("transfer me");
		const outcome = await client.parse(bytes, "a.txt");
		expectSuccess(outcome);
		expect(bytes.byteLength).toBe(0);
	});

	it("copies a partial view and leaves the shared buffer alone", async () => {
		const backing = utf8("XXXXhello worldYYYY");
		const outcome = await client.parse(backing.subarray(4, 15), "a.txt");
		expect(expectSuccess(outcome).document.blocks[0]).toMatchObject({
			text: "hello world",
		});
		expect(backing.byteLength).toBe(19);
	});

	it("answers too-big and unsupported through the worker as well", async () => {
		expectError(
			await client.parse(utf8("0123456789A"), "a.txt", { maxBytes: 10 }),
			"too-big",
		);
		expectError(
			await client.parse(Uint8Array.of(0, 1, 2, 0, 0, 9), "x.bin"),
			"unsupported",
		);
	});

	it("rejects calls that are not bytes without posting anything hostile", async () => {
		expectError(await client.parse("text" as never, "a.txt"), "unsupported");
		expectError(await client.parse(utf8("x"), 42 as never), "unsupported");
	});
});

describe("the worker side survives hostile messages", () => {
	it("ignores or rejects garbage and keeps answering real requests", async () => {
		const seen: {
			id?: unknown;
			outcome?: { ok?: boolean; reason?: string };
		}[] = [];
		channel.port2.addEventListener("message", (event) => {
			seen.push(event.data as never);
		});
		channel.port2.start();
		const garbage: unknown[] = [
			null,
			undefined,
			5,
			"parse",
			[],
			{},
			{ type: "parse" },
			{ type: "parse", id: 1.5, bytes: new Uint8Array(1), fileName: "a.txt" },
			{ type: "parse", id: -1, bytes: new Uint8Array(1), fileName: "a.txt" },
			{
				type: "parse",
				id: Number.NaN,
				bytes: new Uint8Array(1),
				fileName: "a.txt",
			},
			{ type: "parse", id: "7", bytes: new Uint8Array(1), fileName: "a.txt" },
			{ type: "parse", id: 101 },
			{ type: "parse", id: 102, bytes: "text", fileName: "a.txt" },
			{
				type: "parse",
				id: 103,
				bytes: new Uint8Array(4),
				fileName: { toString: 1 },
			},
			{
				type: "parse",
				id: 104,
				bytes: utf8("hello"),
				fileName: "a.txt",
				hints: "nope",
			},
			{ type: "parse-text", id: 105, text: 5 },
			{ type: "parse-text", id: 106 },
			{ type: "nope", id: 107 },
		];
		for (const message of garbage) channel.port2.postMessage(message);
		channel.port2.postMessage({
			type: "parse",
			id: 999,
			bytes: utf8("still alive"),
			fileName: "a.txt",
		});
		await vi.waitFor(() => expect(seen.some((m) => m.id === 999)).toBe(true));

		const byId = new Map(seen.map((m) => [m.id, m.outcome]));
		// Messages with no usable id get no reply. Messages with one get a typed error.
		for (const id of [101, 102, 103, 107, 105, 106]) {
			expect(byId.get(id), `id ${id}`).toMatchObject({
				ok: false,
				reason: "unsupported",
			});
		}
		expect(byId.get(104)).toMatchObject({ ok: true });
		expect(byId.get(999)).toMatchObject({ ok: true });
		expect(
			seen.every(
				(m) => typeof m.id === "number" && Number.isInteger(m.id) && m.id >= 0,
			),
		).toBe(true);
		expect(seen).toHaveLength(7 + 1);
	});

	it("can be detached, after which it no longer answers", async () => {
		detach();
		const pending = client.parse(utf8("anyone there"), "a.txt");
		const winner = await Promise.race([
			pending.then(() => "answered"),
			new Promise((resolve) => setTimeout(() => resolve("silent"), 100)),
		]);
		expect(winner).toBe("silent");
	});
});

describe("the client side survives a bad worker", () => {
	type Listener = (event: { data?: unknown }) => void;
	function fakeWorker() {
		const listeners = new Map<string, Set<Listener>>();
		const posted: unknown[] = [];
		return {
			posted,
			postMessage(message: unknown) {
				posted.push(message);
			},
			addEventListener(type: string, listener: Listener) {
				if (!listeners.has(type)) listeners.set(type, new Set());
				listeners.get(type)?.add(listener);
			},
			removeEventListener(type: string, listener: Listener) {
				listeners.get(type)?.delete(listener);
			},
			emit(type: string, event: { data?: unknown } = {}) {
				for (const listener of listeners.get(type) ?? []) listener(event);
			},
		};
	}

	it("turns a worker crash into a typed error for every waiting call", async () => {
		const worker = fakeWorker();
		const local = createParserClient(worker as never);
		const a = local.parse(utf8("a"), "a.txt");
		const b = local.parseText("b");
		worker.emit("error");
		expectError(await a, "unsupported");
		expectError(await b, "unsupported");
		expectError(await local.parse(utf8("c"), "c.txt"), "unsupported");
	});

	it("turns a messageerror into a typed error", async () => {
		const worker = fakeWorker();
		const local = createParserClient(worker as never);
		const pending = local.parseText("b");
		worker.emit("messageerror");
		expectError(await pending, "unsupported");
	});

	it("ignores replies it did not ask for and malformed replies", async () => {
		const worker = fakeWorker();
		const local = createParserClient(worker as never);
		const pending = local.parseText("hello");
		const sent = worker.posted[0] as { id: number };
		for (const data of [
			null,
			7,
			"x",
			{},
			{ type: "result" },
			{ type: "result", id: 9999, outcome: {} },
		]) {
			worker.emit("message", { data });
		}
		worker.emit("message", {
			data: {
				type: "result",
				id: sent.id,
				outcome: { ok: false, reason: "empty", message: "nothing" },
			},
		});
		expectError(await pending, "empty");
	});

	it("does not trust a worker that returns an invalid Document", async () => {
		const worker = fakeWorker();
		const local = createParserClient(worker as never);
		const pending = local.parseText("hello");
		const sent = worker.posted[0] as { id: number };
		worker.emit("message", {
			data: {
				type: "result",
				id: sent.id,
				outcome: {
					ok: true,
					document: {
						version: 1,
						blocks: [
							{
								kind: "paragraph",
								text: "x",
								spans: [{ kind: "strong", start: 0, end: 99 }],
							},
						],
					},
					title: null,
					language: { code: "en", source: "unknown" },
					format: "txt",
					encoding: null,
				},
			},
		});
		expectError(await pending, "unsupported");
	});

	it("settles waiting calls and refuses new ones after dispose", async () => {
		const worker = fakeWorker();
		const local = createParserClient(worker as never);
		const pending = local.parseText("hello");
		local.dispose();
		expectError(await pending, "unsupported");
		expectError(await local.parseText("again"), "unsupported");
		local.dispose();
	});
});

describe("worker entry module", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it("can be imported outside a worker without doing anything", async () => {
		vi.resetModules();
		await expect(import("../src/worker")).resolves.toBeDefined();
	});

	it("answers messages on the worker global scope", async () => {
		vi.resetModules();
		let listener: ((event: { data: unknown }) => void) | undefined;
		const postMessage = vi.fn();
		vi.stubGlobal("postMessage", postMessage);
		vi.stubGlobal("addEventListener", (type: string, fn: typeof listener) => {
			if (type === "message") listener = fn;
		});
		await import("../src/worker");
		expect(listener).toBeTypeOf("function");
		listener?.({
			data: { type: "parse-text", id: 5, text: "From the entry." },
		});
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
		const [response] = postMessage.mock.calls[0] ?? [];
		expect(response).toMatchObject({
			type: "result",
			id: 5,
			outcome: { ok: true },
		});
	});
});
