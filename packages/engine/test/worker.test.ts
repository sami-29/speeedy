import { describe, expect, it } from "vitest";
import { buildTimeline, handleBuildRequest } from "../src/index";
import { paragraphs } from "./helpers";

describe("Timeline worker request", () => {
	it("answers a request with the same Timeline buildTimeline gives", () => {
		const document = paragraphs('He said "stop." Then (ok).');
		const response = handleBuildRequest({
			id: 7,
			document,
			settings: { wpm: 450 },
			options: { language: "en" },
		});
		expect(response).toEqual({
			id: 7,
			ok: true,
			timeline: buildTimeline(document, { wpm: 450 }, { language: "en" }),
		});
	});

	it("replies with plain data that structuredClone accepts", () => {
		const response = handleBuildRequest({
			id: 1,
			document: paragraphs("one two"),
		});
		expect(structuredClone(response)).toEqual(response);
	});

	it("reports a failure instead of throwing on a malformed request", () => {
		const response = handleBuildRequest({
			id: 2,
			document: null as never,
		});
		expect(response).toEqual({
			id: 2,
			ok: false,
			error: "timeline could not be built",
		});
	});
});
