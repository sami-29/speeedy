import type { Timeline } from "@speeedy/engine";
import TimelineWorker from "@speeedy/engine/worker?worker";
import {
	createParserClient,
	type MessageScope,
	type ParseOutcome,
	type ParserClient,
} from "@speeedy/parsers";
import ParserWorker from "@speeedy/parsers/worker?worker";
import { engineSettings, type ReaderSettings } from "./settings.ts";
import {
	createTimelineClient,
	type TimelineClient,
} from "./timeline-client.ts";

/** What the start panel hands over: pasted text or a dropped or chosen file. */
export type ReaderSource =
	| { kind: "text"; text: string }
	| { kind: "file"; file: File };

export type OpenResult =
	| {
			ok: true;
			timeline: Timeline;
			title: string | null;
			/** Talks to the Timeline worker that holds this text, for settings rebuilds. */
			client: TimelineClient;
	  }
	| { ok: false; message: string };

export type ReaderLoader = {
	/** Parse the source, then build its first Timeline. Both run in workers. */
	open(source: ReaderSource, settings: ReaderSettings): Promise<OpenResult>;
	/** Stop both workers. Call when the reader goes away. */
	dispose(): void;
};

const BUILD_FAILED = "Speeedy could not prepare that text for reading.";

/**
 * Opens text in the reader without touching the main thread: the parser worker turns the
 * source into a Document and the Timeline worker turns that into the Timeline. Workers
 * start on the first `open` and are reused until `dispose`. The Timeline worker keeps the
 * text it built, so a later settings change is a rebuild there, not here.
 */
export function createReaderLoader(): ReaderLoader {
	let parser: ParserClient | undefined;
	let parserWorker: Worker | undefined;
	let timelineWorker: Worker | undefined;
	let timelines: TimelineClient | undefined;

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
		async open(source, settings) {
			const clients = start();
			const outcome = await parse(clients, source);
			if (!outcome.ok) return { ok: false, message: outcome.message };
			const language =
				outcome.language.code === "und" ? undefined : outcome.language.code;
			const built = await clients.timelines.build({
				document: outcome.document,
				settings: engineSettings(settings),
				options: { language },
			});
			if (!built.ok) return { ok: false, message: BUILD_FAILED };
			return {
				ok: true,
				timeline: built.timeline,
				title: outcome.title,
				client: clients.timelines,
			};
		},
		dispose() {
			parser?.dispose();
			timelines?.dispose();
			parserWorker?.terminate();
			timelineWorker?.terminate();
			parser = undefined;
			timelines = undefined;
		},
	};
}
