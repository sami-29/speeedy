import type { BuildRequest, BuildResponse, Timeline } from "@speeedy/engine";
import TimelineWorker from "@speeedy/engine/worker?worker";
import {
	createParserClient,
	type MessageScope,
	type ParseOutcome,
	type ParserClient,
} from "@speeedy/parsers";
import ParserWorker from "@speeedy/parsers/worker?worker";
import { READER_SETTINGS } from "./settings.ts";

/** What the start panel hands over: pasted text or a dropped or chosen file. */
export type ReaderSource =
	| { kind: "text"; text: string }
	| { kind: "file"; file: File };

export type OpenResult =
	| { ok: true; timeline: Timeline; title: string | null }
	| { ok: false; message: string };

export type ReaderLoader = {
	/** Parse the source, then build its first Timeline. Both run in workers. */
	open(source: ReaderSource): Promise<OpenResult>;
	/** Stop both workers. Call when the reader goes away. */
	dispose(): void;
};

const BUILD_FAILED = "Speeedy could not prepare that text for reading.";

/** One request at a time to the Timeline worker, matched to its reply by id. */
function createTimelineClient(worker: Worker) {
	let nextId = 1;
	return {
		build(request: Omit<BuildRequest, "id">): Promise<BuildResponse> {
			return new Promise((resolve) => {
				const id = nextId++;
				const finish = (response: BuildResponse) => {
					worker.removeEventListener("message", onMessage);
					worker.removeEventListener("error", onError);
					resolve(response);
				};
				const onMessage = (event: MessageEvent<BuildResponse>) => {
					if (event.data?.id === id) finish(event.data);
				};
				const onError = () => finish({ id, ok: false, error: BUILD_FAILED });
				worker.addEventListener("message", onMessage);
				worker.addEventListener("error", onError);
				worker.postMessage({ ...request, id });
			});
		},
	};
}

/**
 * Opens text in the reader without touching the main thread: the parser worker turns the
 * source into a Document and the Timeline worker turns that into the Timeline. Workers
 * start on the first `open` and are reused until `dispose`.
 */
export function createReaderLoader(): ReaderLoader {
	let parser: ParserClient | undefined;
	let parserWorker: Worker | undefined;
	let timelineWorker: Worker | undefined;
	let timelines: ReturnType<typeof createTimelineClient> | undefined;

	const start = () => {
		if (!parser || !timelines) {
			parserWorker = new ParserWorker();
			timelineWorker = new TimelineWorker();
			// A Worker satisfies the client's slice of the message API; its listener types are wider.
			parser = createParserClient(parserWorker as unknown as MessageScope);
			timelines = createTimelineClient(timelineWorker);
		}
		return { parser, timelines };
	};

	const parse = async (
		clients: ReturnType<typeof start>,
		source: ReaderSource,
	): Promise<ParseOutcome> =>
		source.kind === "text"
			? clients.parser.parseText(source.text)
			: clients.parser.parse(await source.file.arrayBuffer(), source.file.name);

	return {
		async open(source) {
			const clients = start();
			const outcome = await parse(clients, source);
			if (!outcome.ok) return { ok: false, message: outcome.message };
			const language =
				outcome.language.code === "und" ? undefined : outcome.language.code;
			const built = await clients.timelines.build({
				document: outcome.document,
				settings: { wpm: READER_SETTINGS.wpm },
				options: { language },
			});
			if (!built.ok) return { ok: false, message: BUILD_FAILED };
			return { ok: true, timeline: built.timeline, title: outcome.title };
		},
		dispose() {
			parser?.dispose();
			parserWorker?.terminate();
			timelineWorker?.terminate();
			parser = undefined;
			timelines = undefined;
		},
	};
}
