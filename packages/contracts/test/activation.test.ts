// The activation and retention events: closed lists, buckets and registry entries (#43).
// Run with: pnpm --filter @speeedy/contracts test:unit
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	CANARY,
	checkEvent,
	clientEvents,
	DAYS_SINCE_FIRST_BUCKETS,
	daysSinceFirstBucket,
	EVENTS,
	FILE_FORMATS,
	LIFETIME_SESSIONS_BUCKETS,
	lifetimeSessionsBucket,
	PARSE_FAILURE_REASONS,
	REFS,
	refFor,
	registryProblems,
	SESSION_SOURCES,
	SURFACES,
} from "../src/index.ts";

/** The channels the ticket allows: `hn`, the four Reddit subs, `ph`, `alternativeto`, the four stores, and the rest. */
const ALLOWED_REFS = [
	"hn",
	"reddit-speedreading",
	"reddit-opensource",
	"reddit-sideproject",
	"reddit-studytips",
	"ph",
	"alternativeto",
	"chrome-store",
	"edge-store",
	"amo",
	"play",
	"github",
	"newsletter",
	"changelog",
	"readme",
];

const session = {
	source: "own",
	surface: "web",
	ref: "hn",
	first_this_month: true,
	days_since_first: "0",
	lifetime_sessions: "1",
};

describe("ref", () => {
	it("lists the allowlist and `other`, nothing more", () => {
		assert.deepEqual([...REFS].sort(), [...ALLOWED_REFS, "other"].sort());
	});

	it.each(ALLOWED_REFS)("keeps %s", (ref) => {
		assert.equal(refFor(ref), ref);
	});

	it.each([
		["an unknown channel", "twitter"],
		["a different case", "HN"],
		["a padded value", " hn"],
		["a URL", "https://example.com/?a=1"],
		["a path", "../../etc/passwd"],
		["an empty value", ""],
		["the canary", CANARY],
		["a near miss", "hn-extra"],
	])("sends %s as other", (_label, raw) => {
		assert.equal(refFor(raw), "other");
	});

	it("sends nothing when there is no ref", () => {
		assert.equal(refFor(null), undefined);
		assert.equal(refFor(undefined), undefined);
	});
});

describe("retention buckets", () => {
	it("lists the days since the first Session as 0, 1-6, 7-29, 30-89, 90-plus", () => {
		assert.deepEqual(
			[...DAYS_SINCE_FIRST_BUCKETS],
			["0", "1-6", "7-29", "30-89", "90-plus"],
		);
	});

	it.each([
		[0, "0"],
		[1, "1-6"],
		[6, "1-6"],
		[7, "7-29"],
		[29, "7-29"],
		[30, "30-89"],
		[89, "30-89"],
		[90, "90-plus"],
		[4000, "90-plus"],
		[-3, "0"],
		[Number.NaN, "0"],
	])("puts %s days in %s", (days, bucket) => {
		assert.equal(daysSinceFirstBucket(days), bucket);
	});

	it("lists the lifetime Sessions as 1, 2-5, 6-20, 21-plus", () => {
		assert.deepEqual(
			[...LIFETIME_SESSIONS_BUCKETS],
			["1", "2-5", "6-20", "21-plus"],
		);
	});

	it.each([
		[1, "1"],
		[2, "2-5"],
		[5, "2-5"],
		[6, "6-20"],
		[20, "6-20"],
		[21, "21-plus"],
		[100_000, "21-plus"],
		[0, "1"],
		[Number.NaN, "1"],
	])("puts %s Sessions in %s", (count, bucket) => {
		assert.equal(lifetimeSessionsBucket(count), bucket);
	});
});

describe("the closed lists", () => {
	it("names the three sources and the four surfaces", () => {
		assert.deepEqual([...SESSION_SOURCES], ["own", "demo", "share"]);
		assert.deepEqual([...SURFACES], ["web", "pwa", "twa", "share-link"]);
	});

	it("names the parse failure reasons the parsers raise, and a format list with an `other`", () => {
		assert.deepEqual(
			[...PARSE_FAILURE_REASONS],
			[
				"drm",
				"scanned-pdf",
				"unsupported",
				"empty",
				"encoding-suspect",
				"too-big",
			],
		);
		assert.ok(FILE_FORMATS.includes("other"));
		for (const format of ["txt", "pdf", "epub", "docx", "rtf", "doc"]) {
			assert.ok(FILE_FORMATS.includes(format), format);
		}
		assert.ok(!FILE_FORMATS.includes("pasted"));
	});
});

describe("session_started", () => {
	const allowed = clientEvents(EVENTS);

	it("is a client event and the registry stays sound", () => {
		assert.ok("session_started" in allowed);
		assert.deepEqual(registryProblems(EVENTS), []);
	});

	it("accepts a full payload, with or without a ref", () => {
		assert.equal(checkEvent(allowed, "session_started", session).ok, true);
		const { ref: _ref, ...without } = session;
		assert.equal(checkEvent(allowed, "session_started", without).ok, true);
	});

	it.each(SESSION_SOURCES)("accepts the source %s", (source) => {
		assert.equal(
			checkEvent(allowed, "session_started", { ...session, source }).ok,
			true,
		);
	});

	it.each(SURFACES)("accepts the surface %s", (surface) => {
		assert.equal(
			checkEvent(allowed, "session_started", { ...session, surface }).ok,
			true,
		);
	});

	it.each(REFS)("accepts the ref %s", (ref) => {
		assert.equal(
			checkEvent(allowed, "session_started", { ...session, ref }).ok,
			true,
		);
	});

	it.each([
		["a ref off the list", { ref: "twitter" }],
		["a URL as the ref", { ref: "https://example.com/?a=1" }],
		["the canary as the ref", { ref: CANARY }],
		["an unknown source", { source: "extension" }],
		["an unknown surface", { surface: "extension" }],
		["an exact day count", { days_since_first: "37" }],
		["an exact Session count", { lifetime_sessions: "37" }],
		["a number for a bucket", { lifetime_sessions: 37 }],
		["a string for the flag", { first_this_month: "yes" }],
	])("rejects %s", (_label, change) => {
		assert.equal(
			checkEvent(allowed, "session_started", { ...session, ...change }).ok,
			false,
		);
	});

	it.each([
		"url",
		"title",
		"document_text",
		"hash",
		"first_session_date",
		"words",
	])("rejects an undeclared property %s", (name) => {
		const result = checkEvent(allowed, "session_started", {
			...session,
			[name]: CANARY,
		});
		assert.equal(result.ok, false);
	});

	it("needs the source, the surface, the flag and both buckets", () => {
		for (const key of [
			"source",
			"surface",
			"first_this_month",
			"days_since_first",
			"lifetime_sessions",
		]) {
			const { [key]: _gone, ...rest } = session as Record<string, unknown>;
			assert.equal(checkEvent(allowed, "session_started", rest).ok, false, key);
		}
	});
});

describe("file_uploaded and parse_failed", () => {
	const allowed = clientEvents(EVENTS);

	it("are client events", () => {
		assert.ok("file_uploaded" in allowed);
		assert.ok("parse_failed" in allowed);
	});

	it.each(FILE_FORMATS)("file_uploaded accepts the format %s", (format) => {
		assert.equal(checkEvent(allowed, "file_uploaded", { format }).ok, true);
	});

	it.each(PARSE_FAILURE_REASONS)(
		"parse_failed accepts the reason %s",
		(reason) => {
			assert.equal(checkEvent(allowed, "parse_failed", { reason }).ok, true);
		},
	);

	it.each([
		["a file name as the format", { format: "report.pdf" }],
		["the canary as the format", { format: CANARY }],
		["a word count", { format: "txt", words: 1200 }],
		["a file name", { format: "txt", name: "secret.txt" }],
		["a size", { format: "txt", bytes: 10 }],
	])("file_uploaded rejects %s", (_label, props) => {
		assert.equal(checkEvent(allowed, "file_uploaded", props).ok, false);
	});

	it.each([
		["the parser's message as the reason", { reason: "This PDF is a scan." }],
		["the canary as the reason", { reason: CANARY }],
		["a format beside the reason", { reason: "empty", format: "txt" }],
	])("parse_failed rejects %s", (_label, props) => {
		assert.equal(checkEvent(allowed, "parse_failed", props).ok, false);
	});
});

describe("what the three events can carry", () => {
	it("is enums and flags only: no text and no numbers", () => {
		for (const name of ["session_started", "file_uploaded", "parse_failed"]) {
			const def = EVENTS[name as keyof typeof EVENTS];
			assert.ok(def, `${name} is registered`);
			for (const [prop, spec] of Object.entries(def.props)) {
				assert.ok(
					spec.kind === "enum" || spec.kind === "bool",
					`${name}.${prop} is ${spec.kind}`,
				);
			}
		}
	});
});
