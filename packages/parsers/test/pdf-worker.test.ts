import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	attachParserWorker,
	createParserClient,
	type ParserClient,
	parse,
} from "../src/index";
import { expectError, expectSuccess } from "./helpers";
import { buildPdf } from "./pdf-builder";

/**
 * Same message-channel stand-in for the worker as `worker.test.ts`. The real Web Worker is
 * covered by the browser test in `e2e/`; this checks that a PDF and its typed errors cross
 * the boundary unchanged.
 */
let channel: MessageChannel;
let detach: () => void;
let client: ParserClient;

beforeEach(() => {
	channel = new MessageChannel();
	detach = attachParserWorker(channel.port1 as never);
	client = createParserClient(channel.port2 as never);
});

afterEach(() => {
	client.dispose();
	detach();
	channel.port1.close();
	channel.port2.close();
});

const fixture = (name: string) =>
	new Uint8Array(
		readFileSync(join(import.meta.dirname, "fixtures", "pdf", name)),
	);

describe("pdf through the worker boundary", () => {
	it("returns the same Document as a direct call", async () => {
		const bytes = fixture("article-block-paragraphs.pdf");
		const direct = await parse(bytes.slice(), "a.pdf");
		const viaWorker = await client.parse(bytes.slice(), "a.pdf");
		expect(viaWorker).toEqual(direct);
		expect(expectSuccess(viaWorker).format).toBe("pdf");
	});

	it("carries the typed errors", async () => {
		expectError(
			await client.parse(fixture("scanned-page.pdf"), "s.pdf"),
			"scanned-pdf",
		);
		expectError(
			await client.parse(fixture("locked-user-password.pdf"), "l.pdf"),
			"drm",
		);
		expectError(
			await client.parse(fixture("blank-page.pdf"), "b.pdf"),
			"empty",
		);
	});

	it("serves several PDFs at once", async () => {
		const names = [
			"paper-two-column.pdf",
			"textbook-pages.pdf",
			"article-block-paragraphs.pdf",
		];
		const results = await Promise.all(
			names.map((name) => client.parse(fixture(name), name)),
		);
		for (const result of results)
			expect(expectSuccess(result).document.blocks.length).toBeGreaterThan(10);
	});

	it("passes the time limit across the boundary", async () => {
		const pages = Array.from({ length: 200 }, (_, i) => ({
			runs: [{ x: 72, y: 700, text: `Page text number ${i}.` }],
		}));
		const bytes = buildPdf({ pages });
		expectError(
			await client.parse(bytes, "a.pdf", { maxMillis: 1 }),
			"too-big",
		);
	}, 30_000);

	it("answers a damaged PDF with a typed error and keeps serving", async () => {
		const good = buildPdf({
			pages: [{ runs: [{ x: 72, y: 700, text: "Still alive." }] }],
		});
		const damaged = good.slice(0, 200);
		const first = await client.parse(damaged, "d.pdf");
		expect(first.ok).toBe(false);
		expect(
			expectSuccess(await client.parse(good, "g.pdf")).document.blocks,
		).toHaveLength(1);
	});
});
