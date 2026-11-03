import {
	DEV_EXTENSION_ID,
	LAUNCHER_LIMITS,
	type LauncherPage,
} from "@speeedy/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type IncomingMessage,
	isTrustedOrigin,
	type LauncherWindow,
	startLauncherReceiver,
	trustOf,
} from "../src/lib/launcher/receiver.ts";

const EXTENSION = `chrome-extension://${DEV_EXTENSION_ID}`;
const TRUSTED = [EXTENSION, "moz-extension://*"];

type Sent = { message: unknown; targetOrigin: string };

/** A window that can be sent messages and remembers what it posted to its opener. */
function fakeWindow(withOpener = true) {
	const listeners = new Set<(event: IncomingMessage) => void>();
	const toOpener: Sent[] = [];
	const opener = {
		postMessage: (message: unknown, targetOrigin: string) =>
			toOpener.push({ message, targetOrigin }),
	};
	const window: LauncherWindow = {
		opener: withOpener ? opener : null,
		addEventListener: (_type, listener) => listeners.add(listener),
		removeEventListener: (_type, listener) => listeners.delete(listener),
	};
	const peer = () => {
		const received: Sent[] = [];
		return {
			received,
			postMessage: (message: unknown, targetOrigin: string) =>
				received.push({ message, targetOrigin }),
		};
	};
	return {
		window,
		opener,
		toOpener,
		peer,
		listenerCount: () => listeners.size,
		send(event: IncomingMessage) {
			for (const listener of [...listeners]) listener(event);
		},
	};
}

const validPage = (overrides: Partial<LauncherPage> = {}): LauncherPage => ({
	type: "speeedy:page",
	version: 1,
	title: "A fine article",
	url: "https://news.example/story",
	language: "en",
	document: {
		version: 1,
		blocks: [{ kind: "paragraph", text: "First paragraph.", spans: [] }],
	},
	...overrides,
});

const running: Array<{ stop(): void }> = [];
afterEach(() => {
	for (const receiver of running.splice(0)) receiver.stop();
});

function start(
	withOpener = true,
	answer: () => Promise<boolean> = async () => true,
) {
	const env = fakeWindow(withOpener);
	const save = vi.fn(async (_page: LauncherPage) => {});
	const confirm = vi.fn(async (_page: LauncherPage) => answer());
	const receiver = startLauncherReceiver({
		window: env.window,
		trusted: TRUSTED,
		save,
		confirm,
	});
	running.push(receiver);
	return { env, save, confirm };
}

const FIREFOX = "moz-extension://2f0c8e5a-6d6e-4d5e-9a49-7b2d6a2f0c11";

describe("isTrustedOrigin", () => {
	it("trusts the listed Chromium extension and nothing that only looks like it", () => {
		expect(isTrustedOrigin(EXTENSION, TRUSTED)).toBe(true);
		for (const origin of [
			`chrome-extension://${DEV_EXTENSION_ID.slice(0, -1)}a`,
			`${EXTENSION}.evil.example`,
			`${EXTENSION}/`,
			`https://${DEV_EXTENSION_ID}.example`,
			`https://chrome-extension://${DEV_EXTENSION_ID}`,
			`CHROME-EXTENSION://${DEV_EXTENSION_ID.toUpperCase()}`,
			"null",
			"",
			"https://speeedy.app",
			"http://localhost:4173",
		]) {
			expect(isTrustedOrigin(origin, TRUSTED), origin).toBe(false);
		}
	});

	it("trusts any Firefox extension origin when the list says so, in the right shape", () => {
		expect(
			isTrustedOrigin(
				"moz-extension://2f0c8e5a-6d6e-4d5e-9a49-7b2d6a2f0c11",
				TRUSTED,
			),
		).toBe(true);
		for (const origin of [
			"moz-extension://",
			"moz-extension://not a uuid",
			"moz-extension://2f0c8e5a-6d6e-4d5e-9a49-7b2d6a2f0c11.evil.example",
			"moz-extension://2f0c8e5a-6d6e-4d5e-9a49-7b2d6a2f0c11/x",
			"https://moz-extension://2f0c8e5a-6d6e-4d5e-9a49-7b2d6a2f0c11",
		]) {
			expect(isTrustedOrigin(origin, TRUSTED), origin).toBe(false);
		}
		expect(
			isTrustedOrigin("moz-extension://2f0c8e5a-6d6e-4d5e-9a49-7b2d6a2f0c11", [
				EXTENSION,
			]),
		).toBe(false);
	});

	it("trusts nothing when the list is empty", () => {
		expect(isTrustedOrigin(EXTENSION, [])).toBe(false);
	});
});

describe("trustOf", () => {
	it("saves straight away only for an extension whose ID is pinned", () => {
		expect(trustOf(EXTENSION, TRUSTED)).toBe("auto");
	});

	it("asks the reader first when only the Firefox pattern matched", () => {
		expect(trustOf(FIREFOX, TRUSTED)).toBe("confirm");
	});

	it("asks the reader first for a Chromium ID listed as ask", () => {
		const other = `chrome-extension://${"b".repeat(32)}`;
		expect(trustOf(other, [`ask:${other}`])).toBe("confirm");
		expect(trustOf(EXTENSION, [`ask:${other}`])).toBeNull();
	});

	it("matches nothing else", () => {
		expect(trustOf("https://evil.example", TRUSTED)).toBeNull();
		expect(trustOf("null", TRUSTED)).toBeNull();
		expect(trustOf(EXTENSION, [])).toBeNull();
	});
});

describe("the handshake", () => {
	it("tells its opener it is ready, without naming a target it cannot know", () => {
		const { env } = start();
		expect(env.toOpener).toEqual([
			{ message: { type: "speeedy:ready", version: 1 }, targetOrigin: "*" },
		]);
	});

	it("says nothing when nothing opened it", () => {
		const { env } = start(false);
		expect(env.toOpener).toEqual([]);
	});

	it("stops listening when stopped", () => {
		const { env } = start();
		expect(env.listenerCount()).toBe(1);
		running.pop()?.stop();
		expect(env.listenerCount()).toBe(0);
	});
});

describe("a page from the extension", () => {
	it("is saved, acknowledged to the extension's origin only, and handed over once", async () => {
		const { env, save } = start();
		env.send({ data: validPage(), origin: EXTENSION, source: env.opener });
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		expect(save).toHaveBeenCalledWith(validPage());
		await vi.waitFor(() =>
			expect(env.toOpener.at(-1)).toEqual({
				message: { type: "speeedy:ack", version: 1, ok: true },
				targetOrigin: EXTENSION,
			}),
		);
	});

	it("is saved without asking when the extension's ID is pinned", async () => {
		const { env, save, confirm } = start();
		env.send({ data: validPage(), origin: EXTENSION, source: env.opener });
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		expect(confirm).not.toHaveBeenCalled();
	});

	it("takes only the first page of a load, so a flood saves one document", async () => {
		const { env, save } = start();
		for (let i = 0; i < 5; i++) {
			env.send({
				data: validPage({ title: `Page ${i}` }),
				origin: EXTENSION,
				source: env.opener,
			});
		}
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(save).toHaveBeenCalledTimes(1);
		expect(save.mock.calls[0]?.[0].title).toBe("Page 0");
	});

	it("is acknowledged as refused, and not saved, when the Library cannot keep it", async () => {
		const env = fakeWindow();
		const save = vi.fn(async () => {
			throw new Error("quota");
		});
		running.push(
			startLauncherReceiver({ window: env.window, trusted: TRUSTED, save }),
		);
		env.send({ data: validPage(), origin: EXTENSION, source: env.opener });
		await vi.waitFor(() =>
			expect(env.toOpener.at(-1)).toEqual({
				message: { type: "speeedy:ack", version: 1, ok: false },
				targetOrigin: EXTENSION,
			}),
		);
	});
});

describe("hostile senders", () => {
	it("ignores a look-alike page posted by a web page, even from the window that opened this tab", async () => {
		const { env, save } = start();
		env.send({
			data: validPage(),
			origin: "https://evil.example",
			source: env.opener,
		});
		env.send({ data: validPage(), origin: "null", source: env.opener });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(save).not.toHaveBeenCalled();
		// No answer either: an untrusted page learns nothing from this tab.
		expect(env.toOpener).toHaveLength(1);
	});

	it("ignores a trusted origin that comes from some other window", async () => {
		const { env, save } = start();
		const frame = env.peer();
		env.send({ data: validPage(), origin: EXTENSION, source: frame });
		env.send({ data: validPage(), origin: EXTENSION, source: null });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(save).not.toHaveBeenCalled();
		expect(frame.received).toEqual([]);
		expect(env.toOpener).toHaveLength(1);
	});

	it("ignores everything when nothing opened this tab", async () => {
		const { env, save } = start(false);
		env.send({ data: validPage(), origin: EXTENSION, source: null });
		env.send({ data: validPage(), origin: EXTENSION, source: undefined });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(save).not.toHaveBeenCalled();
	});

	it("ignores a message from another Chromium extension", async () => {
		const { env, save } = start();
		env.send({
			data: validPage(),
			origin: `chrome-extension://${"a".repeat(32)}`,
			source: env.opener,
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(save).not.toHaveBeenCalled();
	});

	it("ignores the ready and ack messages and keeps waiting for a page", async () => {
		const { env, save } = start();
		env.send({
			data: { type: "speeedy:ready", version: 1 },
			origin: EXTENSION,
			source: env.opener,
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(save).not.toHaveBeenCalled();
		env.send({ data: validPage(), origin: EXTENSION, source: env.opener });
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
	});
});

describe("hostile payloads from a trusted sender", () => {
	const refused = async (data: unknown) => {
		const { env, save } = start();
		env.send({ data, origin: EXTENSION, source: env.opener });
		await vi.waitFor(() => expect(env.toOpener).toHaveLength(2));
		expect(save).not.toHaveBeenCalled();
		expect(env.toOpener[1]).toEqual({
			message: { type: "speeedy:ack", version: 1, ok: false },
			targetOrigin: EXTENSION,
		});
		return env;
	};

	it("refuses an oversized document without saving", async () => {
		const blocks = Array.from({ length: LAUNCHER_LIMITS.blocks + 1 }, () => ({
			kind: "paragraph",
			text: "x",
			spans: [],
		}));
		await refused({ ...validPage(), document: { version: 1, blocks } });
	});

	it("refuses text over the cap", async () => {
		const text = "x".repeat(LAUNCHER_LIMITS.characters + 1);
		await refused({
			...validPage(),
			document: {
				version: 1,
				blocks: [{ kind: "paragraph", text, spans: [] }],
			},
		});
	});

	it("refuses the wrong shape", async () => {
		await refused({ type: "speeedy:page", version: 1 });
		await refused("<script>alert(1)</script>");
		await refused({ ...validPage(), extra: true });
	});

	it("refuses a source URL that is not a web address", async () => {
		await refused({ ...validPage(), url: "javascript:alert(1)" });
	});

	it("refuses a Document that fails the Document model", async () => {
		await refused({
			...validPage(),
			document: { version: 1, blocks: [{ kind: "iframe", src: "x" }] },
		});
	});

	it("still takes a good page after a refused one", async () => {
		const { env, save } = start();
		env.send({ data: { nope: 1 }, origin: EXTENSION, source: env.opener });
		env.send({ data: validPage(), origin: EXTENSION, source: env.opener });
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
	});
});

describe("a page from a Firefox extension, whose sender cannot be pinned", () => {
	it("is shown to the reader first and saved only once they keep it", async () => {
		let answer: (keep: boolean) => void = () => {};
		const { env, save, confirm } = start(
			true,
			() => new Promise<boolean>((resolve) => (answer = resolve)),
		);
		env.send({ data: validPage(), origin: FIREFOX, source: env.opener });
		await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith(validPage()));
		expect(save).not.toHaveBeenCalled();
		expect(env.toOpener).toHaveLength(1);
		answer(true);
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		await vi.waitFor(() =>
			expect(env.toOpener.at(-1)).toEqual({
				message: { type: "speeedy:ack", version: 1, ok: true },
				targetOrigin: FIREFOX,
			}),
		);
	});

	it("is dropped and refused when the reader discards it, and the next page may still come", async () => {
		const answers = [false, true];
		const { env, save, confirm } = start(
			true,
			async () => answers.shift() ?? false,
		);
		env.send({
			data: validPage({ title: "No" }),
			origin: FIREFOX,
			source: env.opener,
		});
		await vi.waitFor(() =>
			expect(env.toOpener.at(-1)).toEqual({
				message: { type: "speeedy:ack", version: 1, ok: false },
				targetOrigin: FIREFOX,
			}),
		);
		expect(save).not.toHaveBeenCalled();
		env.send({
			data: validPage({ title: "Yes" }),
			origin: FIREFOX,
			source: env.opener,
		});
		await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		expect(confirm).toHaveBeenCalledTimes(2);
	});

	it("ignores further pages while the reader is deciding", async () => {
		const { env, confirm } = start(true, () => new Promise<boolean>(() => {}));
		for (let i = 0; i < 4; i++) {
			env.send({ data: validPage(), origin: FIREFOX, source: env.opener });
		}
		await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(confirm).toHaveBeenCalledTimes(1);
	});

	it("never asks about a page that fails validation", async () => {
		const { env, confirm } = start();
		env.send({ data: { nope: 1 }, origin: FIREFOX, source: env.opener });
		await vi.waitFor(() => expect(env.toOpener).toHaveLength(2));
		expect(confirm).not.toHaveBeenCalled();
	});

	it("is refused when there is no way to ask the reader", async () => {
		const env = fakeWindow();
		const save = vi.fn(async () => {});
		running.push(
			startLauncherReceiver({ window: env.window, trusted: TRUSTED, save }),
		);
		env.send({ data: validPage(), origin: FIREFOX, source: env.opener });
		await vi.waitFor(() =>
			expect(env.toOpener.at(-1)).toEqual({
				message: { type: "speeedy:ack", version: 1, ok: false },
				targetOrigin: FIREFOX,
			}),
		);
		expect(save).not.toHaveBeenCalled();
	});
});
