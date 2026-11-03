import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	DEV_EXTENSION_ID,
	DEV_EXTENSION_KEY,
	isLauncherAck,
	isLauncherReady,
	LAUNCHER_LIMITS,
	LAUNCHER_VERSION,
	type LauncherPage,
	launcherAck,
	launcherReady,
	validateLauncherPage,
} from "../src/index";

const paragraph = (text: string, spans: unknown[] = []) => ({
	kind: "paragraph",
	text,
	spans,
});

const page = (
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	type: "speeedy:page",
	version: LAUNCHER_VERSION,
	title: "A fine article",
	url: "https://news.example/story?id=7",
	language: "en",
	document: { version: 1, blocks: [paragraph("First paragraph.")] },
	...overrides,
});

const reason = (value: unknown) => {
	const result = validateLauncherPage(value);
	return result.ok ? "ok" : result.reason;
};

describe("a well-formed page message", () => {
	it("is accepted and handed back whole", () => {
		const result = validateLauncherPage(page());
		expect(result).toEqual({
			ok: true,
			page: page() as unknown as LauncherPage,
		});
	});

	it("may carry an empty title, the app picks one from the text", () => {
		expect(reason(page({ title: "" }))).toBe("ok");
	});

	it("takes `und` as the language", () => {
		expect(reason(page({ language: "und" }))).toBe("ok");
		expect(reason(page({ language: "pt-BR" }))).toBe("ok");
	});

	it("drops credentials from the URL before it is kept", () => {
		const result = validateLauncherPage(
			page({ url: "https://user:secret@news.example/story" }),
		);
		expect(result.ok && result.page.url).toBe("https://news.example/story");
	});
});

describe("the wrong shape", () => {
	it.each([null, undefined, "text", 7, true, [], [page()]])(
		"refuses %j as not an object",
		(value) => {
			expect(reason(value)).toBe("not-an-object");
		},
	);

	it("refuses another message type", () => {
		expect(reason(page({ type: "speeedy:ready" }))).toBe("wrong-type");
		expect(reason(page({ type: undefined }))).toBe("wrong-type");
	});

	it("refuses another protocol version", () => {
		expect(reason(page({ version: 2 }))).toBe("wrong-version");
		expect(reason(page({ version: "1" }))).toBe("wrong-version");
	});

	it("refuses an unknown field", () => {
		expect(reason(page({ extra: 1 }))).toBe("wrong-shape");
	});

	it("refuses a missing or mistyped field", () => {
		for (const key of ["title", "url", "language", "document"]) {
			const without = page();
			delete without[key];
			expect(reason(without), `missing ${key}`).toBe("wrong-shape");
		}
		expect(reason(page({ title: 5 }))).toBe("wrong-shape");
		expect(reason(page({ language: ["en"] }))).toBe("wrong-shape");
	});

	it("refuses a __proto__ key smuggled in through JSON", () => {
		const hostile = JSON.parse(
			'{"__proto__":{"polluted":true},"type":"speeedy:page","version":1,"title":"t","url":"https://a.example/","language":"en","document":{"version":1,"blocks":[]}}',
		);
		expect(reason(hostile)).toBe("wrong-shape");
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("never throws on a getter or a proxy that throws", () => {
		const getter = page();
		Object.defineProperty(getter, "title", {
			enumerable: true,
			get() {
				throw new Error("boom");
			},
		});
		expect(() => validateLauncherPage(getter)).not.toThrow();
		expect(reason(getter)).not.toBe("ok");
		const proxy = new Proxy(
			{},
			{
				get() {
					throw new Error("boom");
				},
				ownKeys() {
					throw new Error("boom");
				},
			},
		);
		expect(() => validateLauncherPage(proxy)).not.toThrow();
		expect(reason(proxy)).not.toBe("ok");
	});
});

describe("the source URL", () => {
	it.each([
		"javascript:alert(1)",
		"data:text/html,<p>hi</p>",
		"file:///etc/passwd",
		"ftp://files.example/a",
		"chrome://settings",
		"about:blank",
		"//news.example/story",
		"not a url",
		"",
	])("refuses %j", (url) => {
		expect(reason(page({ url }))).toBe("bad-url");
	});

	it("refuses a URL over the cap", () => {
		const url = `https://news.example/${"a".repeat(LAUNCHER_LIMITS.url)}`;
		expect(reason(page({ url }))).toBe("too-big");
	});
});

describe("the language", () => {
	it.each(["en_US", "<script>", "", "e", "english language", "en-"])(
		"refuses %j",
		(language) => {
			expect(reason(page({ language }))).toBe("bad-language");
		},
	);

	it("refuses a tag over the cap", () => {
		expect(
			reason(page({ language: `en-${"a".repeat(LAUNCHER_LIMITS.language)}` })),
		).toBe("too-big");
	});
});

describe("the caps", () => {
	it("refuses a title over the cap", () => {
		expect(reason(page({ title: "t".repeat(LAUNCHER_LIMITS.title + 1) }))).toBe(
			"too-big",
		);
		expect(reason(page({ title: "t".repeat(LAUNCHER_LIMITS.title) }))).toBe(
			"ok",
		);
	});

	it("refuses more blocks than the cap before reading any of them", () => {
		const blocks = Array.from({ length: LAUNCHER_LIMITS.blocks + 1 }, () =>
			paragraph("x"),
		);
		expect(reason(page({ document: { version: 1, blocks } }))).toBe("too-big");
	});

	it("refuses a sparse array of absurd length without walking it", () => {
		const blocks = new Array(2 ** 32 - 1);
		const started = performance.now();
		expect(reason(page({ document: { version: 1, blocks } }))).toBe("too-big");
		expect(performance.now() - started).toBeLessThan(250);
	});

	it("refuses more text than the cap", () => {
		const half = "x".repeat(LAUNCHER_LIMITS.characters / 2 + 1);
		const blocks = [paragraph(half), paragraph(half)];
		expect(reason(page({ document: { version: 1, blocks } }))).toBe("too-big");
	});

	it("refuses more spans than the cap", () => {
		const spans = [{ kind: "strong", start: 0, end: 1 }];
		const blocks = Array.from({ length: LAUNCHER_LIMITS.spans + 1 }, () =>
			paragraph("x", spans),
		);
		expect(reason(page({ document: { version: 1, blocks } }))).toBe("too-big");
	});

	it("accepts a document just under every cap", () => {
		const blocks = Array.from({ length: 1000 }, () =>
			paragraph("x".repeat(4000)),
		);
		expect(reason(page({ document: { version: 1, blocks } }))).toBe("ok");
	});
});

describe("the Document", () => {
	it("goes through the Document model validator", () => {
		expect(reason(page({ document: { version: 2, blocks: [] } }))).toBe(
			"bad-document",
		);
		expect(
			reason(page({ document: { version: 1, blocks: [{ kind: "script" }] } })),
		).toBe("bad-document");
		expect(
			reason(
				page({
					document: {
						version: 1,
						blocks: [
							paragraph("short", [{ kind: "strong", start: 0, end: 99 }]),
						],
					},
				}),
			),
		).toBe("bad-document");
		expect(reason(page({ document: "plain text" }))).toBe("wrong-shape");
	});

	it("refuses a link whose scheme could run script", () => {
		for (const href of [
			"javascript:alert(1)",
			"data:text/html,x",
			"vbscript:x",
		]) {
			const spans = [{ kind: "link", start: 0, end: 5, href }];
			expect(
				reason(
					page({
						document: { version: 1, blocks: [paragraph("hello", spans)] },
					}),
				),
				href,
			).toBe("bad-document");
		}
		const safe = [
			{ kind: "link", start: 0, end: 5, href: "https://a.example/x" },
		];
		expect(
			reason(
				page({ document: { version: 1, blocks: [paragraph("hello", safe)] } }),
			),
		).toBe("ok");
	});
});

describe("ready and ack messages", () => {
	it("are built and recognised", () => {
		expect(isLauncherReady(launcherReady())).toBe(true);
		expect(isLauncherAck(launcherAck(true))).toBe(true);
		expect(isLauncherAck(launcherAck(false))).toBe(true);
		expect(launcherAck(false)).toEqual({
			type: "speeedy:ack",
			version: 1,
			ok: false,
		});
	});

	it("are not confused with each other or with junk", () => {
		expect(isLauncherReady(launcherAck(true))).toBe(false);
		expect(isLauncherAck(launcherReady())).toBe(false);
		expect(isLauncherAck({ type: "speeedy:ack", version: 1 })).toBe(false);
		expect(isLauncherAck({ type: "speeedy:ack", version: 1, ok: "yes" })).toBe(
			false,
		);
		expect(isLauncherReady(null)).toBe(false);
		expect(isLauncherReady({ type: "speeedy:ready", version: 2 })).toBe(false);
	});
});

describe("the development extension key", () => {
	it("gives the extension ID the app trusts in development", () => {
		const der = Buffer.from(DEV_EXTENSION_KEY, "base64");
		const digest = createHash("sha256").update(der).digest("hex").slice(0, 32);
		const id = [...digest]
			.map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
			.join("");
		expect(id).toBe(DEV_EXTENSION_ID);
	});
});
