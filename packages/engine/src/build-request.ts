import type { Document } from "@speeedy/contracts";
import { buildTimeline } from "./timeline";
import type { EngineSettings, Timeline, TimelineOptions } from "./types";

/** What the app posts to the Timeline worker. */
export type BuildRequest = {
	id: number;
	document: Document;
	settings?: Partial<EngineSettings>;
	options?: TimelineOptions;
};

/** The worker's reply: the Timeline as plain data, or a failure. */
export type BuildResponse =
	| { id: number; ok: true; timeline: Timeline }
	| { id: number; ok: false; error: string };

/** The worker's whole job. Pure, so it is testable without a worker. */
export function handleBuildRequest(request: BuildRequest): BuildResponse {
	try {
		return {
			id: request.id,
			ok: true,
			timeline: buildTimeline(
				request.document,
				request.settings,
				request.options,
			),
		};
	} catch {
		return { id: request.id, ok: false, error: "timeline could not be built" };
	}
}
