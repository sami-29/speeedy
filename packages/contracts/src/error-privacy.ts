import { ERROR_CODES, EXCEPTION_LIMITS } from "./errors.ts";
import { CANARY } from "./privacy.ts";

export interface ErrorPrivacyCase {
	label: string;
	properties: unknown;
}

const GOOD_FRAME = { file: "/_app/a.js", line: 1, col: 1, function: "f" };

/** Names a careless change might add to carry page content or a URL. */
const LEAKY_NAMES = ["document_text", "title", "url", "hash"];

/**
 * Payloads an `$exception` must reject. The canary stands in for document text and is tried in
 * every place text could ride: the message, variables, source context, each frame field,
 * the code, and properties that do not exist.
 */
export function errorPrivacyCases(): ErrorPrivacyCase[] {
	const base = { code: ERROR_CODES[0], frames: [GOOD_FRAME] };
	const withFrame = (extra: Record<string, unknown>) => ({
		...base,
		frames: [{ ...GOOD_FRAME, ...extra }],
	});
	const cases: ErrorPrivacyCase[] = [
		{ label: "canary in the code", properties: { ...base, code: CANARY } },
		{
			label: "canary as the message",
			properties: { ...base, message: CANARY },
		},
		{ label: "canary as the value", properties: { ...base, value: CANARY } },
		{
			label: "canary as the issue description",
			properties: { ...base, $issue_description: CANARY },
		},
		{
			label: "canary as the fingerprint",
			properties: { ...base, $exception_fingerprint: CANARY },
		},
		{
			label: "canary in a PostHog exception list",
			properties: { ...base, $exception_list: [{ value: CANARY }] },
		},
		{
			label: "canary in top-level vars",
			properties: { ...base, vars: { text: CANARY } },
		},
		{
			label: "canary in frames given as a string",
			properties: { ...base, frames: CANARY },
		},
		{
			label: "canary in a frame given as a string",
			properties: { ...base, frames: [CANARY] },
		},
		{
			label: "frames over the limit",
			properties: {
				...base,
				frames: Array.from(
					{ length: EXCEPTION_LIMITS.frames + 1 },
					() => GOOD_FRAME,
				),
			},
		},
		{
			label: "canary in file with a query",
			properties: withFrame({ file: `/a.js?${CANARY}` }),
		},
		{
			label: "canary in file with a hash",
			properties: withFrame({ file: `/a.js#${CANARY}` }),
		},
		{
			label: "canary in file with an origin",
			properties: withFrame({ file: `https://${CANARY}.test/a.js` }),
		},
		{
			label: "canary in file that is not a script",
			properties: withFrame({ file: `/${CANARY}` }),
		},
		{
			label: "canary in file with a space",
			properties: withFrame({ file: `/${CANARY} text.js` }),
		},
		{
			label: "file over its bound",
			properties: withFrame({
				file: `/${"a".repeat(EXCEPTION_LIMITS.file)}.js`,
			}),
		},
		{
			label: "canary in function",
			properties: withFrame({ function: CANARY }),
		},
		{
			label: "canary in function with a quote",
			properties: withFrame({ function: `"${CANARY}"` }),
		},
		{
			label: "function over its bound",
			properties: withFrame({
				function: "f".repeat(EXCEPTION_LIMITS.function + 1),
			}),
		},
		{ label: "canary in line", properties: withFrame({ line: CANARY }) },
		{ label: "canary in col", properties: withFrame({ col: CANARY }) },
	];
	for (const name of [
		"vars",
		"context_line",
		"pre_context",
		"post_context",
		"message",
		"abs_path",
		"filename",
		...LEAKY_NAMES,
	]) {
		cases.push({
			label: `canary in a frame's undeclared property ${name}`,
			properties: withFrame({ [name]: CANARY }),
		});
	}
	for (const name of LEAKY_NAMES) {
		cases.push({
			label: `canary in undeclared top-level property ${name}`,
			properties: { ...base, [name]: CANARY },
		});
	}
	return cases;
}

function withStack(stack: string, extra: Record<string, unknown> = {}): Error {
	return Object.assign(new Error("x"), extra, { stack });
}

/**
 * Thrown values that carry document text in every place an error can: its message, name,
 * stack header, properties, cause, and frame locations. Nothing but frames may leave.
 */
export function hostileErrors(): unknown[] {
	const frame = "    at real (https://speeedy.app/_app/real.js:2:3)";
	const message = `${CANARY}\n    at forged (https://speeedy.app/_app/${CANARY}.js:1:1)\n    at ${CANARY} (https://speeedy.app/_app/x.js:1:1)`;
	const named = new Error(CANARY);
	named.name = CANARY;
	const throwing = new Error("x");
	Object.defineProperty(throwing, "stack", {
		get() {
			throw new Error(CANARY);
		},
	});
	return [
		new Error(CANARY),
		named,
		withStack(`Error: ${message}\n${frame}`, { message }),
		withStack(`${CANARY}: ${CANARY}\n${frame}`, { name: CANARY }),
		withStack(`Error: x\n${frame}`, {
			documentText: CANARY,
			vars: { text: CANARY },
			context_line: CANARY,
			cause: new Error(CANARY),
		}),
		withStack(
			[
				"Error: x",
				`    at ${CANARY} (https://speeedy.app/_app/a.js:1:1)`,
				`    at fine (https://speeedy.app/read?q=${CANARY}#${CANARY}:1:1)`,
				`    at data (data:text/javascript,${CANARY}:1:1)`,
				`    at blob (blob:https://speeedy.app/${CANARY}:1:1)`,
				`    at "${CANARY}" (https://speeedy.app/_app/b.js:1:1)`,
				`${CANARY}@https://speeedy.app/_app/c.js?${CANARY}:4:5`,
				`${CANARY}`,
			].join("\n"),
		),
		{ message: CANARY, name: CANARY, stack: `${CANARY}\n${frame}` },
		{ message: { text: CANARY }, stack: { text: CANARY } },
		{ documentText: CANARY },
		new AggregateError([new Error(CANARY)], CANARY),
		withStack(`Error: ${"x".repeat(100_000)}${CANARY}\n${frame}`, {
			message: `${"x".repeat(100_000)}${CANARY}`,
		}),
		throwing,
		CANARY,
		`Error: ${CANARY}\n${frame}`,
		42,
		null,
		undefined,
	];
}
