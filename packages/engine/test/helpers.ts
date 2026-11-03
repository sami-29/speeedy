import type { Document } from "@speeedy/contracts";
import {
	buildTimeline,
	type EngineSettings,
	type Frame,
	type TimelineOptions,
} from "../src/index";

/** A Document of plain paragraphs, one per string. */
export function paragraphs(...texts: string[]): Document {
	return {
		version: 1,
		blocks: texts.map((text) => ({ kind: "paragraph", text, spans: [] })),
	};
}

export function framesOf(
	text: string,
	settings: Partial<EngineSettings> = {},
	options?: TimelineOptions,
): Frame[] {
	return buildTimeline(paragraphs(text), settings, options).frames;
}

export function wordsOf(
	text: string,
	settings: Partial<EngineSettings> = {},
	options?: TimelineOptions,
): string[] {
	return framesOf(text, settings, options).map((frame) => frame.text);
}
