/**
 * Error reports: Speeedy's own `$exception` events.
 *
 * An error report carries an error code and stack frames, and nothing else. There is no
 * message (an error message can hold document text), no variables, no source lines and no
 * stack header. It has its own fixed shape instead of a place in the event registry, so the
 * registry's general rules (no nested values, no `$` names) stay as strict as they were.
 *
 * Three steps share this file:
 *  - the app builds a report from a thrown value (`buildException`),
 *  - the Worker checks the report against the fixed shape (`checkException`) and turns it
 *    into PostHog's `$exception` properties (`toPostHogException`),
 *  - the app hooks up the global handlers (`installErrorCapture`).
 */

export const EXCEPTION_EVENT = "$exception";
export const EXCEPTION_SCHEMA_VERSION = 1;

/** The only error codes. The code is the PostHog fingerprint, so one code is one issue group. */
export const ERROR_CODES = [
	"unhandled_error",
	"unhandled_rejection",
	"render_error",
	"parser_error",
	"storage_error",
	"audio_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** `$issue_description`: a fixed sentence per code, never taken from the error. */
export const ISSUE_DESCRIPTIONS: Readonly<Record<ErrorCode, string>> = {
	unhandled_error: "An error nobody caught",
	unhandled_rejection: "A promise failed and nobody handled it",
	render_error: "The page failed while drawing",
	parser_error: "Reading a document failed",
	storage_error: "Saving or loading on this device failed",
	audio_error: "Playing or making audio failed",
};

export const EXCEPTION_LIMITS = {
	/** Frames kept, from the top of the stack. */
	frames: 20,
	/** Characters of a script path. */
	file: 80,
	/** Characters of a function name. */
	function: 80,
	maxLine: 10_000_000,
	maxCol: 10_000_000,
	/** Reports one Visit may send. A crash loop must not flood. */
	perVisit: 5,
} as const;

/** The file of a frame that is not one of our own bundles (eval, data:, blob:, extensions, other sites). */
export const EXTERNAL_FILE = "external";
/** The function of a frame whose name is not a plain identifier path. */
export const UNKNOWN_FUNCTION = "?";

/** Where in a stack the parser looks. A longer stack is cut off, not read. */
const MAX_STACK_CHARS = 50_000;
const MAX_STACK_LINES = 400;

export interface ErrorFrame {
	/** One of our own bundle paths (no origin, query or hash), or `external` with line and col 0. */
	file: string;
	line: number;
	col: number;
	/** Identifiers joined by dots, or `?`. */
	function: string;
}

export interface ExceptionProperties {
	code: ErrorCode;
	frames: ErrorFrame[];
}

/**
 * The exact file names the build emits, and nothing else. `<hash>` is the eight characters of
 * base64url that Vite puts in a name, so no free word fits anywhere in the path:
 *   chunks/<hash>.js   entry/(app|start|payload).<hash>.js   nodes/<1-3 digits>.<hash>.js   workers/worker-<hash>.js
 * `app/scripts/bundle-paths.ts` checks every script in the built site against this, so a
 * Vite or SvelteKit naming change fails the build instead of turning every frame external.
 */
const BUNDLE_PATH =
	/^\/_app\/immutable\/(?:chunks\/[A-Za-z0-9_-]{8}|entry\/(?:app|start|payload)\.[A-Za-z0-9_-]{8}|nodes\/[0-9]{1,3}\.[A-Za-z0-9_-]{8}|workers\/worker-[A-Za-z0-9_-]{8})\.js$/;
/** One to four JavaScript identifiers joined by dots, each up to 40 characters. */
const FUNCTION_PATH =
	/^[A-Za-z_$][A-Za-z0-9_$]{0,39}(?:\.[A-Za-z_$][A-Za-z0-9_$]{0,39}){0,3}$/;
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a path of one of the app's own built scripts. */
export function isBundlePath(path: string): boolean {
	return BUNDLE_PATH.test(path);
}

function isFile(value: unknown): value is string {
	return (
		value === EXTERNAL_FILE ||
		(typeof value === "string" &&
			value.length <= EXCEPTION_LIMITS.file &&
			BUNDLE_PATH.test(value))
	);
}

function isFunction(value: unknown): value is string {
	return (
		value === UNKNOWN_FUNCTION ||
		(typeof value === "string" &&
			value.length <= EXCEPTION_LIMITS.function &&
			FUNCTION_PATH.test(value))
	);
}

function isBounded(value: unknown, max: number): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= max
	);
}

/** The page's own origin, when running in a page. Absent in a Worker or a test. */
function ownOrigin(): string | undefined {
	const origin = (globalThis as { location?: { origin?: unknown } }).location
		?.origin;
	return typeof origin === "string" && origin !== "null" ? origin : undefined;
}

/** Cuts a script location down to our own bundle path, or to `external`. */
function filePath(location: string): string {
	const origin = ORIGIN.exec(location)?.[0];
	const mine = ownOrigin();
	if (origin !== undefined && mine !== undefined && origin !== mine)
		return EXTERNAL_FILE;
	const path = location.replace(ORIGIN, "").split(/[?#]/, 1)[0];
	return isFile(path) ? path : EXTERNAL_FILE;
}

function functionName(raw: string): string {
	const name = raw.replace(/^(?:async|new)\s+/, "").trim();
	return isFunction(name) ? name : UNKNOWN_FUNCTION;
}

const CHROME_FRAME = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)$/;

function parseFrame(line: string): ErrorFrame | null {
	const text = line.trim();
	const match = text.startsWith("at ")
		? CHROME_FRAME.exec(text)
		: GECKO_FRAME.exec(text);
	if (!match) return null;
	const [, name, location, lineNo, colNo] = match;
	const lineNumber = Number(lineNo);
	const col = Number(colNo);
	if (
		!isBounded(lineNumber, EXCEPTION_LIMITS.maxLine) ||
		!isBounded(col, EXCEPTION_LIMITS.maxCol)
	)
		return null;
	const file = filePath(location);
	// A frame outside our bundles says nothing about our code: it keeps no line, column or name.
	if (file === EXTERNAL_FILE)
		return { file, line: 0, col: 0, function: UNKNOWN_FUNCTION };
	return {
		file,
		line: lineNumber,
		col,
		function: functionName(name ?? ""),
	};
}

function readString(source: unknown, key: string): string {
	try {
		const value = (source as Record<string, unknown>)[key];
		return typeof value === "string" ? value : "";
	} catch {
		return "";
	}
}

/**
 * Takes the message out of the stack header. Chrome and Node put the message in the stack,
 * and a message with line breaks can contain lines that look like frames.
 */
function withoutMessage(stack: string, message: string): string {
	if (message === "") return stack;
	const at = stack.indexOf(message);
	if (at < 0) return stack;
	const before = stack.slice(0, at);
	const after = stack.slice(at + message.length);
	const headerStart = before === "" || /^[^\n]*: ?$/.test(before);
	const headerEnd = after === "" || after.startsWith("\n");
	return headerStart && headerEnd ? after : stack;
}

/** Reads stack frames out of a thrown value. Anything that is not a frame is ignored. */
export function framesFromError(error: unknown): ErrorFrame[] {
	if (typeof error !== "object" || error === null) return [];
	const stack = readString(error, "stack").slice(0, MAX_STACK_CHARS);
	if (stack === "") return [];
	const lines = withoutMessage(stack, readString(error, "message")).split(
		"\n",
		MAX_STACK_LINES,
	);
	const frames: ErrorFrame[] = [];
	for (const line of lines) {
		const frame = parseFrame(line);
		if (frame) frames.push(frame);
		if (frames.length === EXCEPTION_LIMITS.frames) break;
	}
	return frames;
}

export interface ExceptionEvent {
	event: typeof EXCEPTION_EVENT;
	properties: ExceptionProperties;
}

/** Builds the report for a thrown value. Only its stack frames are read; its text never is. */
export function buildException(
	error: unknown,
	code: ErrorCode,
): ExceptionEvent {
	return {
		event: EXCEPTION_EVENT,
		properties: { code, frames: framesFromError(error) },
	};
}

export type ExceptionCheck =
	| { ok: true; properties: ExceptionProperties }
	| {
			ok: false;
			reason:
				| "bad_properties"
				| "unknown_property"
				| "bad_property_value"
				| "missing_property";
	  };

const FRAME_KEYS = ["file", "line", "col", "function"];

function frameProblem(
	frame: unknown,
): "bad_property_value" | "unknown_property" | "missing_property" | null {
	if (!isRecord(frame)) return "bad_property_value";
	const keys = Object.keys(frame);
	if (keys.some((key) => !FRAME_KEYS.includes(key))) return "unknown_property";
	if (FRAME_KEYS.some((key) => !Object.hasOwn(frame, key)))
		return "missing_property";
	if (
		!isFile(frame.file) ||
		!isBounded(frame.line, EXCEPTION_LIMITS.maxLine) ||
		!isBounded(frame.col, EXCEPTION_LIMITS.maxCol) ||
		!isFunction(frame.function)
	)
		return "bad_property_value";
	// An external frame is a fixed marker: no position and no name.
	if (
		frame.file === EXTERNAL_FILE &&
		(frame.line !== 0 || frame.col !== 0 || frame.function !== UNKNOWN_FUNCTION)
	)
		return "bad_property_value";
	return null;
}

/** Checks a report against its fixed shape. The Worker's `/api/e` admits this and nothing more. */
export function checkException(properties: unknown): ExceptionCheck {
	if (!isRecord(properties)) return { ok: false, reason: "bad_properties" };
	if (Object.keys(properties).some((key) => key !== "code" && key !== "frames"))
		return { ok: false, reason: "unknown_property" };
	if (
		!Object.hasOwn(properties, "code") ||
		!Object.hasOwn(properties, "frames")
	)
		return { ok: false, reason: "missing_property" };
	const { code, frames } = properties;
	if (
		typeof code !== "string" ||
		!(ERROR_CODES as readonly string[]).includes(code)
	)
		return { ok: false, reason: "bad_property_value" };
	if (!Array.isArray(frames) || frames.length > EXCEPTION_LIMITS.frames)
		return { ok: false, reason: "bad_property_value" };
	const clean: ErrorFrame[] = [];
	for (const frame of frames) {
		const problem = frameProblem(frame);
		if (problem) return { ok: false, reason: problem };
		const { file, line, col, function: name } = frame as ErrorFrame;
		clean.push({ file, line, col, function: name });
	}
	return { ok: true, properties: { code: code as ErrorCode, frames: clean } };
}

/**
 * PostHog's `$exception` properties for a checked report: an empty message, frames only,
 * the code as the fingerprint and a fixed description. Nothing in it comes from the client
 * except the code and the frame fields that `checkException` has bounded.
 */
export function toPostHogException(
	properties: ExceptionProperties,
): Record<string, unknown> {
	return {
		$exception_list: [
			{
				type: properties.code,
				value: "",
				mechanism: { handled: false, synthetic: false },
				stacktrace: {
					type: "raw",
					frames: properties.frames.map((frame) => ({
						platform: "web:javascript",
						filename: frame.file,
						function: frame.function,
						lineno: frame.line,
						colno: frame.col,
						in_app: frame.file !== EXTERNAL_FILE,
					})),
				},
			},
		],
		$exception_fingerprint: properties.code,
		$issue_description: ISSUE_DESCRIPTIONS[properties.code],
		$exception_level: "error",
	};
}

/** What `installErrorCapture` needs from the send function. */
export interface ErrorSender {
	trackError(error: unknown, code: ErrorCode): boolean;
}

/** The two things a window offers to listen on. */
export interface ErrorTarget {
	addEventListener(type: string, listener: (event: Event) => void): void;
	removeEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * Reports uncaught errors and unhandled promise rejections. Pass `window`. Returns a
 * function that stops it. A failing sender never breaks the page.
 */
export function installErrorCapture(
	target: ErrorTarget,
	sender: ErrorSender,
): () => void {
	const report = (error: unknown, code: ErrorCode) => {
		try {
			sender.trackError(error, code);
		} catch {
			// Reporting an error must never cause one.
		}
	};
	const onError = (event: Event) =>
		report((event as { error?: unknown }).error ?? null, "unhandled_error");
	const onRejection = (event: Event) =>
		report(
			(event as { reason?: unknown }).reason ?? null,
			"unhandled_rejection",
		);
	target.addEventListener("error", onError);
	target.addEventListener("unhandledrejection", onRejection);
	return () => {
		target.removeEventListener("error", onError);
		target.removeEventListener("unhandledrejection", onRejection);
	};
}

/** The published description of the `$exception` shape, for the event list. */
export function renderExceptionMarkdown(): string {
	const codes = ERROR_CODES.map((code) => `\`${code}\``).join(", ");
	return [
		"## `$exception`",
		"",
		"An error report. It carries an error code and stack frames and nothing else: no error message, no variables, no source lines. A frame is one of the app's own bundle paths, a line, a column and a function name; code from anywhere else is a fixed `external` frame. It does not go through the registry above; it has its own fixed shape, and the server turns it into PostHog's `$exception` with an empty message, the code as the fingerprint and a fixed description per code.",
		"",
		`Sent by: the app. Schema version ${EXCEPTION_SCHEMA_VERSION}. At most ${EXCEPTION_LIMITS.perVisit} per Visit.`,
		"",
		"| Property | Value | Required |",
		"| --- | --- | --- |",
		`| \`code\` | one of ${codes} | yes |`,
		`| \`frames\` | up to ${EXCEPTION_LIMITS.frames} stack frames, each one of the app's own bundle paths (no origin, query or hash) or the fixed marker \`external\`, a line, a column and a function name that is plain identifiers joined by dots (or \`?\`) | yes |`,
		"",
	].join("\n");
}
