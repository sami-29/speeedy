import type { Document, Position } from "@speeedy/contracts";
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

/** A built Timeline, and the link to the worker that holds the text it was built from. */
export type Built = {
	timeline: Timeline;
	/** Talks to the Timeline worker that holds this text, for settings rebuilds. */
	client: TimelineClient;
};

export type OpenResult =
	| ({
			ok: true;
			title: string | null;
			/** What the parser made of the source, so the Library can keep it. */
			document: Document;
			/** The detected language: a BCP 47 tag, `und` when unknown. */
			language: string;
	  } & Built)
	| { ok: false; message: string };

export type ParseSourceResult =
	| { ok: true; document: Document; title: string | null; language: string }
	| { ok: false; message: string };

export type ReaderLoader = {
	/** Parse the source, then build its first Timeline. Both run in workers. */
	open(source: ReaderSource, settings: ReaderSettings): Promise<OpenResult>;
	/** Parse the source and stop there. The Library page keeps the Document without reading it. */
	parse(source: ReaderSource): Promise<ParseSourceResult>;
	/**
	 * Build a Timeline for a stored Document. `anchor` is where the reader resumes, so the
	 * speed ramp counts from there. Null when the build fails.
	 */
	build(
		document: Document,
		options: { language: string; anchor?: Position },
		settings: ReaderSettings,
	): Promise<Built | null>;
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

	const build = async (
		clients: ReturnType<typeof start>,
		document: Document,
		language: string,
		settings: ReaderSettings,
		anchor?: Position,
	): Promise<Built | null> => {
		const built = await clients.timelines.build({
			document,
			settings: engineSettings(settings),
			options: {
				language: language === "und" ? undefined : language,
				anchor,
			},
		});
		return built.ok
			? { timeline: built.timeline, client: clients.timelines }
			: null;
	};

	return {
		async open(source, settings) {
			const clients = start();
			const outcome = await parse(clients, source);
			if (!outcome.ok) return { ok: false, message: outcome.message };
			const built = await build(
				clients,
				outcome.document,
				outcome.language.code,
				settings,
			);
			if (!built) return { ok: false, message: BUILD_FAILED };
			return {
				ok: true,
				...built,
				title: outcome.title,
				document: outcome.document,
				language: outcome.language.code,
			};
		},
		async parse(source) {
			const outcome = await parse(start(), source);
			if (!outcome.ok) return { ok: false, message: outcome.message };
			return {
				ok: true,
				document: outcome.document,
				title: outcome.title,
				language: outcome.language.code,
			};
		},
		build(document, options, settings) {
			return build(
				start(),
				document,
				options.language,
				settings,
				options.anchor,
			);
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
