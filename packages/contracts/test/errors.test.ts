// Error reports: `$exception` events carry stack frames and an error code, and nothing else.
// Run with: pnpm --filter @speeedy/contracts test:unit
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
	buildException,
	CANARY,
	checkEvent,
	checkException,
	createAnalytics,
	ERROR_CODES,
	EVENTS,
	EXCEPTION_EVENT,
	EXCEPTION_LIMITS,
	errorPrivacyCases,
	framesFromError,
	hostileErrors,
	ISSUE_DESCRIPTIONS,
	installErrorCapture,
	registryProblems,
	renderEventListMarkdown,
	toPostHogException,
} from "../src/index.ts";

function errorWith(stack: string, message = "boom"): Error {
	const error = new Error(message);
	error.stack = stack;
	return error;
}

const CHROME = `Error: boom
    at parseThing (https://speeedy.app/_app/immutable/chunks/abc123.js:1:4521)
    at async Object.load (https://speeedy.app/_app/immutable/nodes/2.js?v=1#frag:3:17)
    at https://speeedy.app/_app/immutable/entry/app.js:1:900`;

const GECKO = `parseThing@https://speeedy.app/_app/immutable/chunks/abc123.js:1:4521
load/<@https://speeedy.app/_app/immutable/nodes/2.js:3:17
@https://speeedy.app/_app/immutable/entry/app.js:1:900`;

const SAFARI = `parseThing@https://speeedy.app/_app/immutable/chunks/abc123.js:1:4521
global code@https://speeedy.app/_app/immutable/entry/app.js:1:900
[native code]`;

describe("framesFromError", () => {
	it("reads a Chrome stack and keeps file path, line, column and function only", () => {
		assert.deepEqual(framesFromError(errorWith(CHROME)), [
			{
				file: "/_app/immutable/chunks/abc123.js",
				line: 1,
				col: 4521,
				function: "parseThing",
			},
			{
				file: "/_app/immutable/nodes/2.js",
				line: 3,
				col: 17,
				function: "Object.load",
			},
			{
				file: "/_app/immutable/entry/app.js",
				line: 1,
				col: 900,
				function: "",
			},
		]);
	});

	it("reads a Firefox stack", () => {
		const frames = framesFromError(errorWith(GECKO));
		assert.equal(frames.length, 3);
		assert.deepEqual(frames[1], {
			file: "/_app/immutable/nodes/2.js",
			line: 3,
			col: 17,
			function: "load/<",
		});
		assert.equal(frames[2].function, "");
	});

	it("reads a Safari stack and skips native frames", () => {
		const frames = framesFromError(errorWith(SAFARI));
		assert.equal(frames.length, 2);
		assert.equal(frames[1].function, "global code");
	});

	it("keeps at most the frame limit, from the top", () => {
		const lines = Array.from(
			{ length: 60 },
			(_, i) => `    at f${i} (https://speeedy.app/_app/a.js:${i + 1}:1)`,
		);
		const frames = framesFromError(errorWith(`Error: x\n${lines.join("\n")}`));
		assert.equal(frames.length, EXCEPTION_LIMITS.frames);
		assert.equal(frames[0].function, "f0");
	});

	it("drops a file that is not a script path, and a function that is not a name", () => {
		const frames = framesFromError(
			errorWith(
				[
					"Error: x",
					`    at ok (https://speeedy.app/s?d=${CANARY}#${CANARY}:5:6)`,
					`    at ${CANARY} (https://speeedy.app/_app/a.js:5:6)`,
					`    at data (data:text/javascript,${CANARY}:1:1)`,
				].join("\n"),
			),
		);
		assert.ok(!JSON.stringify(frames).includes(CANARY));
		for (const frame of frames) {
			assert.ok(frame.file === "" || /\.(m?js|ts|svelte)$/.test(frame.file));
		}
	});

	it("never reads the message, even when it looks like a frame", () => {
		const message = `${CANARY}\n    at forged (https://speeedy.app/_app/${CANARY}.js:1:1)`;
		const error = new Error(message);
		error.stack = `Error: ${message}\n    at real (https://speeedy.app/_app/real.js:2:3)`;
		const frames = framesFromError(error);
		assert.deepEqual(
			frames.map((f) => f.function),
			["real"],
		);
	});

	it("returns no frames for something that is not an error with a stack", () => {
		for (const value of [undefined, null, 5, CANARY, {}, { stack: 12 }]) {
			assert.deepEqual(framesFromError(value), []);
		}
	});

	it("reads a real error from this runtime without throwing", () => {
		const frames = framesFromError(new Error(CANARY));
		assert.ok(!JSON.stringify(frames).includes(CANARY));
		assert.ok(frames.length <= EXCEPTION_LIMITS.frames);
	});

	it("stays fast on a huge stack", () => {
		const huge = `Error: x\n${"    at f (https://speeedy.app/_app/a.js:1:1)\n".repeat(200_000)}`;
		const started = Date.now();
		const frames = framesFromError(errorWith(huge));
		assert.equal(frames.length, EXCEPTION_LIMITS.frames);
		assert.ok(Date.now() - started < 1000);
	});
});

describe("buildException", () => {
	it("builds the fixed wire shape: a code and frames", () => {
		const event = buildException(errorWith(CHROME), "unhandled_error");
		assert.equal(event.event, EXCEPTION_EVENT);
		assert.deepEqual(Object.keys(event.properties).sort(), ["code", "frames"]);
		assert.equal(event.properties.code, "unhandled_error");
		assert.equal(event.properties.frames.length, 3);
		assert.equal(checkException(event.properties).ok, true);
	});

	it("carries no text from any hostile error", () => {
		for (const [i, hostile] of hostileErrors().entries()) {
			for (const code of ERROR_CODES) {
				const event = buildException(hostile, code);
				assert.ok(
					!JSON.stringify(event).includes(CANARY),
					`hostile error ${i} leaked in the app payload`,
				);
				const checked = checkException(event.properties);
				assert.equal(checked.ok, true, `hostile error ${i} built a bad shape`);
				if (checked.ok) {
					assert.ok(
						!JSON.stringify(toPostHogException(checked.properties)).includes(
							CANARY,
						),
						`hostile error ${i} leaked in the PostHog payload`,
					);
				}
			}
		}
	});
});

describe("checkException", () => {
	const frame = { file: "/_app/a.js", line: 1, col: 2, function: "f" };
	const good = { code: "unhandled_error", frames: [frame] };
	const withFrame = (extra: object) => ({
		...good,
		frames: [{ ...frame, ...extra }],
	});

	it("accepts the fixed shape, with no frames too", () => {
		assert.equal(checkException(good).ok, true);
		assert.equal(
			checkException({ code: "unhandled_error", frames: [] }).ok,
			true,
		);
	});

	it("accepts every declared code", () => {
		for (const code of ERROR_CODES) {
			assert.equal(checkException({ ...good, code }).ok, true, code);
		}
	});

	const rejected: [string, unknown][] = [
		["no properties", undefined],
		["properties that are not an object", []],
		["a code outside the enum", { ...good, code: CANARY }],
		["a code that is not a string", { ...good, code: 3 }],
		["a missing code", { frames: [frame] }],
		["missing frames", { code: "unhandled_error" }],
		["a message property", { ...good, message: CANARY }],
		["a value property", { ...good, value: "" }],
		["a description the client chose", { ...good, issue_description: "x" }],
		[
			"a fingerprint the client chose",
			{ ...good, $exception_fingerprint: "x" },
		],
		["frames that are not an array", { ...good, frames: "at x" }],
		[
			"more frames than the limit",
			{
				...good,
				frames: Array.from(
					{ length: EXCEPTION_LIMITS.frames + 1 },
					() => frame,
				),
			},
		],
		["a frame that is a string", { ...good, frames: ["at f (a.js:1:1)"] }],
		["a frame with variables", withFrame({ vars: { a: 1 } })],
		["a frame with a context line", withFrame({ context_line: CANARY })],
		["a frame with a message", withFrame({ message: "x" })],
		[
			"a frame missing its line",
			{ ...good, frames: [{ file: "/a.js", col: 1, function: "" }] },
		],
		["a file with a query", withFrame({ file: "/a.js?x=1" })],
		["a file with a hash", withFrame({ file: "/a.js#x" })],
		["a file with an origin", withFrame({ file: "https://speeedy.app/a.js" })],
		["a file that is not a script", withFrame({ file: "/s/abc" })],
		[
			"a file over its bound",
			withFrame({ file: `/${"a".repeat(EXCEPTION_LIMITS.file)}.js` }),
		],
		["a file with a space", withFrame({ file: "/a b.js" })],
		["a canary in the function", withFrame({ function: CANARY })],
		[
			"a function over its bound",
			withFrame({ function: "f".repeat(EXCEPTION_LIMITS.function + 1) }),
		],
		["a function given as a number", withFrame({ function: 4 })],
		["a fractional line", withFrame({ line: 1.5 })],
		["a negative column", withFrame({ col: -1 })],
		["a line over its bound", withFrame({ line: 2 ** 31 })],
		["a line given as a string", withFrame({ line: "1" })],
	];
	for (const [label, props] of rejected) {
		it(`rejects ${label}`, () => {
			assert.equal(checkException(props).ok, false);
		});
	}

	it("does not treat Object prototype keys as properties", () => {
		assert.equal(
			checkException(
				JSON.parse('{"code":"unhandled_error","frames":[],"__proto__":"x"}'),
			).ok,
			false,
		);
	});
});

describe("the PostHog event", () => {
	it("has an empty message, frames only, the code as fingerprint and an enum description", () => {
		const checked = checkException({
			code: "unhandled_rejection",
			frames: [{ file: "/_app/a.js", line: 4, col: 9, function: "f" }],
		});
		assert.ok(checked.ok);
		const properties = toPostHogException(checked.properties);
		assert.equal(properties.$exception_fingerprint, "unhandled_rejection");
		assert.ok(
			Object.values(ISSUE_DESCRIPTIONS).includes(
				properties.$issue_description as string,
			),
		);
		const list = properties.$exception_list as {
			type: string;
			value: string;
			stacktrace: { type: string; frames: Record<string, unknown>[] };
		}[];
		assert.equal(list.length, 1);
		assert.equal(list[0].value, "");
		assert.equal(list[0].type, "unhandled_rejection");
		assert.equal(list[0].stacktrace.type, "raw");
		assert.deepEqual(list[0].stacktrace.frames, [
			{
				platform: "web:javascript",
				filename: "/_app/a.js",
				function: "f",
				lineno: 4,
				colno: 9,
				in_app: true,
			},
		]);
	});

	it("has one description per code", () => {
		assert.deepEqual(
			Object.keys(ISSUE_DESCRIPTIONS).sort(),
			[...ERROR_CODES].sort(),
		);
		assert.equal(
			new Set(Object.values(ISSUE_DESCRIPTIONS)).size,
			ERROR_CODES.length,
		);
	});
});

describe("the event registry keeps its rules", () => {
	it("does not list $exception and stays sound", () => {
		assert.ok(!(EXCEPTION_EVENT in EVENTS));
		assert.deepEqual(registryProblems(EVENTS), []);
		assert.equal(
			checkEvent(EVENTS, EXCEPTION_EVENT, {
				code: "unhandled_error",
				frames: [],
			}).ok,
			false,
		);
	});

	it("publishes the $exception shape in the event list", () => {
		const markdown = renderEventListMarkdown(EVENTS);
		assert.match(markdown, /## `\$exception`/);
		assert.match(markdown, /stack frames/i);
		for (const code of ERROR_CODES) assert.ok(markdown.includes(`\`${code}\``));
		const committed = readFileSync(
			new URL("../generated/events.md", import.meta.url),
			"utf8",
		);
		assert.equal(committed, markdown);
	});
});

describe("generated error privacy cases", () => {
	const cases = errorPrivacyCases();

	it("has cases for the message, variables, context and every frame field", () => {
		const labels = cases.map((c) => c.label).join("\n");
		for (const part of [
			"message",
			"vars",
			"context_line",
			"file",
			"function",
			"frames over",
		]) {
			assert.ok(labels.includes(part), part);
		}
		assert.ok(cases.some((c) => JSON.stringify(c.properties).includes(CANARY)));
	});

	it("rejects every case", () => {
		for (const c of cases) {
			assert.equal(checkException(c.properties).ok, false, c.label);
		}
	});
});

describe("the app's send function", () => {
	function setup(options: Parameters<typeof createAnalytics>[0] = {}) {
		const sent: { event: string; properties: Record<string, unknown> }[] = [];
		const analytics = createAnalytics({
			schedule: () => {},
			fetch: async (_url, init) => {
				const body = JSON.parse(String((init as RequestInit).body));
				sent.push(...body.events);
				return new Response(null, { status: 202 });
			},
			...options,
		});
		return { analytics, sent };
	}

	function distinct(n: number): Error {
		return errorWith(
			`Error: x\n    at f${n} (https://speeedy.app/_app/a.js:${n}:1)`,
		);
	}

	it("sends an $exception with a code and frames, without experiment properties", async () => {
		const { analytics, sent } = setup({ experiments: () => ({ exp_x: "b" }) });
		assert.equal(
			analytics.trackError(errorWith(CHROME), "unhandled_error"),
			true,
		);
		await analytics.flush();
		assert.equal(sent.length, 1);
		assert.equal(sent[0].event, EXCEPTION_EVENT);
		assert.deepEqual(Object.keys(sent[0].properties).sort(), [
			"code",
			"frames",
		]);
	});

	it("sends nothing from a hostile error", async () => {
		const { analytics, sent } = setup();
		for (const hostile of hostileErrors())
			analytics.trackError(hostile, "render_error");
		await analytics.flush();
		assert.ok(sent.length > 0);
		assert.ok(!JSON.stringify(sent).includes(CANARY));
	});

	it("sends the same error once, so a loop cannot flood", async () => {
		const { analytics, sent } = setup();
		assert.equal(analytics.trackError(distinct(1), "unhandled_error"), true);
		for (let i = 0; i < 50; i++) {
			assert.equal(analytics.trackError(distinct(1), "unhandled_error"), false);
		}
		await analytics.flush();
		assert.equal(sent.length, 1);
	});

	it("caps the errors one Visit sends", async () => {
		const { analytics, sent } = setup();
		for (let i = 0; i < 40; i++)
			analytics.trackError(distinct(i), "unhandled_error");
		await analytics.flush();
		assert.equal(sent.length, EXCEPTION_LIMITS.perVisit);
	});

	it("keeps a full batch of errors under the Worker's body cap", () => {
		const worst = {
			file: `/${"a".repeat(EXCEPTION_LIMITS.file - 4)}.js`,
			line: EXCEPTION_LIMITS.maxLine,
			col: EXCEPTION_LIMITS.maxCol,
			function: "f".repeat(EXCEPTION_LIMITS.function),
		};
		const one = JSON.stringify({
			event: EXCEPTION_EVENT,
			properties: {
				code: "unhandled_error",
				frames: Array.from({ length: EXCEPTION_LIMITS.frames }, () => worst),
			},
		});
		assert.ok(one.length * EXCEPTION_LIMITS.perVisit < 60_000);
	});
});

describe("installErrorCapture", () => {
	function fire(target: EventTarget, type: string, extra: object) {
		target.dispatchEvent(Object.assign(new Event(type), extra));
	}

	function recorder() {
		const calls: [unknown, string][] = [];
		return {
			calls,
			trackError: (error: unknown, code: string) => {
				calls.push([error, code]);
				return true;
			},
		};
	}

	it("sends global errors and unhandled rejections with their codes", () => {
		const target = new EventTarget();
		const sender = recorder();
		installErrorCapture(target, sender);
		const a = new Error("a");
		const b = new Error("b");
		fire(target, "error", { error: a, message: CANARY });
		fire(target, "unhandledrejection", { reason: b });
		assert.deepEqual(sender.calls, [
			[a, "unhandled_error"],
			[b, "unhandled_rejection"],
		]);
	});

	it("still reports an error the browser hides (no error object)", () => {
		const target = new EventTarget();
		const sender = recorder();
		installErrorCapture(target, sender);
		fire(target, "error", { error: null, message: `Script error ${CANARY}` });
		assert.equal(sender.calls.length, 1);
		assert.deepEqual(framesFromError(sender.calls[0][0]), []);
	});

	it("stops when told to", () => {
		const target = new EventTarget();
		const sender = recorder();
		const stop = installErrorCapture(target, sender);
		stop();
		fire(target, "error", { error: new Error("x") });
		assert.equal(sender.calls.length, 0);
	});

	it("never lets a throwing sender break the page", () => {
		const target = new EventTarget();
		installErrorCapture(target, {
			trackError: () => {
				throw new Error("sender broke");
			},
		});
		assert.doesNotThrow(() => fire(target, "error", { error: new Error("x") }));
	});
});
