import { PARSE_FAILURE_REASONS } from "@speeedy/contracts";
import { PARSE_ERROR_REASONS, type ParseOutcome } from "@speeedy/parsers";
import { describe, expect, it } from "vitest";
import { fileFormatFor, reportParse } from "../src/lib/reader/intake-events.ts";

const ok = (format: Parameters<typeof fileFormatFor>[0]): ParseOutcome => ({
	ok: true,
	document: { version: 1, blocks: [] },
	title: "CANARY title",
	language: { code: "en", source: "stopwords" },
	format,
	encoding: "utf-8",
});
const failed = (reason: PARSE_ERROR_REASON): ParseOutcome => ({
	ok: false,
	reason,
	message: "CANARY-document-text-7f3a9c in a message",
});
type PARSE_ERROR_REASON = (typeof PARSE_ERROR_REASONS)[number];

function run(
	source: Parameters<typeof reportParse>[0],
	outcome: ParseOutcome,
): [string, Record<string, string>][] {
	const sent: [string, Record<string, string>][] = [];
	reportParse(source, outcome, (event, props) => sent.push([event, props]));
	return sent;
}

describe("file_uploaded", () => {
	it.each([
		["txt", "txt"],
		["markdown", "markdown"],
		["csv", "csv"],
		["html", "html"],
		["docx", "docx"],
		["epub", "epub"],
		["odt", "odt"],
		["rtf", "rtf"],
		["doc", "doc"],
		["pdf", "pdf"],
	] as const)("carries the format %s", (parsed, sent) => {
		expect(run({ kind: "file" }, ok(parsed))).toEqual([
			["file_uploaded", { format: sent }],
		]);
	});

	it("has a value for every format the parsers report", () => {
		for (const format of [
			"txt",
			"markdown",
			"csv",
			"html",
			"docx",
			"epub",
			"odt",
			"rtf",
			"doc",
			"pasted",
			"pdf",
		] as const) {
			expect(fileFormatFor(format)).toMatch(/^[a-z]+$/);
		}
	});

	it("reports nothing for pasted text", () => {
		expect(run({ kind: "text" }, ok("pasted"))).toEqual([]);
	});

	it("carries the format and nothing else: no title, count or text", () => {
		const [sent] = run({ kind: "file" }, ok("epub"));
		expect(Object.keys(sent?.[1] ?? {})).toEqual(["format"]);
		expect(JSON.stringify(run({ kind: "file" }, ok("epub")))).not.toContain(
			"CANARY",
		);
	});
});

describe("parse_failed", () => {
	it("is the parsers' reasons one to one", () => {
		expect([...PARSE_FAILURE_REASONS]).toEqual([...PARSE_ERROR_REASONS]);
	});

	it.each(PARSE_ERROR_REASONS)("carries the reason %s", (reason) => {
		expect(run({ kind: "file" }, failed(reason))).toEqual([
			["parse_failed", { reason }],
		]);
	});

	it("never carries the parser's message", () => {
		expect(
			JSON.stringify(run({ kind: "file" }, failed("empty"))),
		).not.toContain("CANARY");
	});

	it("reports nothing for pasted text that fails", () => {
		expect(run({ kind: "text" }, failed("empty"))).toEqual([]);
	});

	it("sends one event per file, never both", () => {
		expect(run({ kind: "file" }, failed("drm"))).toHaveLength(1);
		expect(run({ kind: "file" }, ok("pdf"))).toHaveLength(1);
	});
});
