import { validateDocument } from "@speeedy/contracts";
import { parse, parseText, toBytes } from "./parse";
import {
	PARSE_ERROR_REASONS,
	type ParseErrorReason,
	type ParseHints,
	type ParseOutcome,
} from "./types";

/**
 * The message protocol between the page and the parser worker.
 *
 * The page sends a `ParseRequest` and the worker answers each one with a `ParseResponse`
 * carrying the same `id`. Both sides treat the other as untrusted: the worker validates
 * every request and answers a malformed one with a typed error (or ignores it when there
 * is no usable id), and the client validates every response, including the Document.
 */

export type ParseRequest =
	| {
			type: "parse";
			id: number;
			bytes: Uint8Array | ArrayBuffer;
			fileName: string;
			hints?: ParseHints;
	  }
	| { type: "parse-text"; id: number; text: string; hints?: ParseHints };

export type ParseResponse = {
	type: "result";
	id: number;
	outcome: ParseOutcome;
};

/** The slice of a worker or message-port scope that the protocol uses. */
export type MessageScope = {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	addEventListener(type: string, listener: (event: never) => void): void;
	removeEventListener?(type: string, listener: (event: never) => void): void;
	start?(): void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function error(reason: ParseErrorReason, message: string): ParseOutcome {
	return { ok: false, reason, message };
}

const readId = (data: unknown): number | null => {
	try {
		return isRecord(data) && isId(data.id) ? data.id : null;
	} catch {
		return null;
	}
};

/**
 * Answer one request. Returns null when the message has no usable id, since there is no one
 * to answer. Never throws.
 */
export async function handleRequest(
	data: unknown,
): Promise<ParseResponse | null> {
	const id = readId(data);
	if (id === null || !isRecord(data)) return null;
	let outcome: ParseOutcome;
	try {
		if (data.type === "parse") {
			const bytes = toBytes(data.bytes);
			outcome =
				bytes && typeof data.fileName === "string"
					? await parse(bytes, data.fileName, data.hints as ParseHints)
					: error("unsupported", "That is not a file Speeedy can read.");
		} else if (data.type === "parse-text") {
			outcome =
				typeof data.text === "string"
					? await parseText(data.text, data.hints as ParseHints)
					: error("unsupported", "That is not text Speeedy can read.");
		} else {
			outcome = error(
				"unsupported",
				"Speeedy did not understand that request.",
			);
		}
	} catch {
		outcome = error("unsupported", "Speeedy could not read this file.");
	}
	return { type: "result", id, outcome };
}

/**
 * Serve parse requests on a worker's global scope (or one end of a message channel).
 * Returns a function that stops serving.
 */
export function attachParserWorker(scope: MessageScope): () => void {
	const listener = (event: { data?: unknown } | undefined) => {
		void handleRequest(event?.data).then((response) => {
			if (!response) return;
			try {
				scope.postMessage(response);
			} catch {
				scope.postMessage({
					type: "result",
					id: response.id,
					outcome: error("unsupported", "Speeedy could not read this file."),
				});
			}
		});
	};
	scope.addEventListener("message", listener as (event: never) => void);
	scope.start?.();
	return () => {
		scope.removeEventListener?.("message", listener as (event: never) => void);
	};
}

/** True when the value is a well-formed outcome: a valid Document, or a typed error. */
function isTrustedOutcome(value: unknown): value is ParseOutcome {
	if (!isRecord(value)) return false;
	if (value.ok === true) return validateDocument(value.document).ok;
	return (
		value.ok === false &&
		typeof value.message === "string" &&
		(PARSE_ERROR_REASONS as readonly unknown[]).includes(value.reason)
	);
}

export type ParserClient = {
	parse(
		bytes: Uint8Array | ArrayBuffer,
		fileName: string,
		hints?: ParseHints,
	): Promise<ParseOutcome>;
	parseText(text: string, hints?: ParseHints): Promise<ParseOutcome>;
	/** Stop listening and settle every waiting call with a typed error. */
	dispose(): void;
};

const WORKER_GONE = "The file reader stopped unexpectedly. Try again.";

/** Keep only the hint fields the parser reads, so the message always clones. */
function plainHints(hints: unknown): ParseHints | undefined {
	if (!isRecord(hints)) return undefined;
	const out: ParseHints = {};
	if (typeof hints.encoding === "string") out.encoding = hints.encoding;
	if (typeof hints.language === "string") out.language = hints.language;
	if (typeof hints.maxBytes === "number") out.maxBytes = hints.maxBytes;
	if (typeof hints.maxBlocks === "number") out.maxBlocks = hints.maxBlocks;
	if (typeof hints.maxMillis === "number") out.maxMillis = hints.maxMillis;
	return out;
}

/**
 * A promise-based client for a parser worker (or the other end of a message channel):
 * `createParserClient(new Worker(...))`. `parse` takes ownership of a whole `ArrayBuffer`
 * it is given, so a large file moves to the worker without a copy; a partial view is
 * copied first so the shared buffer is left alone.
 */
export function createParserClient(scope: MessageScope): ParserClient {
	const pending = new Map<number, (outcome: ParseOutcome) => void>();
	let nextId = 1;
	let closed = false;

	const settleAll = (message: string) => {
		const waiting = [...pending.values()];
		pending.clear();
		for (const resolve of waiting) resolve(error("unsupported", message));
	};

	const onMessage = (event: { data?: unknown } | undefined) => {
		const data = event?.data;
		if (!isRecord(data) || data.type !== "result" || !isId(data.id)) return;
		const resolve = pending.get(data.id);
		if (!resolve) return;
		pending.delete(data.id);
		resolve(
			isTrustedOutcome(data.outcome)
				? data.outcome
				: error(
						"unsupported",
						"The file reader sent back something unreadable.",
					),
		);
	};
	// A worker that reports an error is treated as gone: waiting calls get a typed error and
	// later calls fail at once. The app starts a fresh worker.
	const shutdown = () => {
		if (closed) return;
		closed = true;
		scope.removeEventListener?.("message", onMessage as (event: never) => void);
		scope.removeEventListener?.("error", shutdown as (event: never) => void);
		scope.removeEventListener?.(
			"messageerror",
			shutdown as (event: never) => void,
		);
		settleAll(WORKER_GONE);
	};

	scope.addEventListener("message", onMessage as (event: never) => void);
	scope.addEventListener("error", shutdown as (event: never) => void);
	scope.addEventListener("messageerror", shutdown as (event: never) => void);
	scope.start?.();

	const send = (
		build: (id: number) => ParseRequest,
		transfer: Transferable[],
	): Promise<ParseOutcome> =>
		new Promise<ParseOutcome>((resolve) => {
			if (closed) {
				resolve(error("unsupported", WORKER_GONE));
				return;
			}
			const id = nextId++;
			pending.set(id, resolve);
			try {
				scope.postMessage(build(id), transfer);
			} catch {
				pending.delete(id);
				resolve(
					error(
						"unsupported",
						"Speeedy could not send that file to the reader.",
					),
				);
			}
		});

	return {
		parse(bytes, fileName, hints) {
			const view = toBytes(bytes);
			if (!view || typeof fileName !== "string") {
				return Promise.resolve(
					error("unsupported", "That is not a file Speeedy can read."),
				);
			}
			const whole =
				view.byteOffset === 0 &&
				view.byteLength === view.buffer.byteLength &&
				view.buffer instanceof ArrayBuffer;
			// `new Uint8Array(view)` copies, even for a Node Buffer view of a shared pool.
			const payload = whole ? view : new Uint8Array(view);
			const clean = plainHints(hints);
			return send(
				(id) => ({ type: "parse", id, bytes: payload, fileName, hints: clean }),
				[payload.buffer as ArrayBuffer],
			);
		},
		parseText(text, hints) {
			if (typeof text !== "string") {
				return Promise.resolve(
					error("unsupported", "That is not text Speeedy can read."),
				);
			}
			const clean = plainHints(hints);
			return send((id) => ({ type: "parse-text", id, text, hints: clean }), []);
		},
		dispose: shutdown,
	};
}
