/**
 * Builds the small hostile fixtures in `test/fixtures/pdf/`: a file cut off part way, bytes
 * that only carry a PDF name, and a file locked with a scheme pdf.js has no key for.
 *
 *   node packages/parsers/fixtures-src/pdf/build-hostile.mts
 *
 * They are generated from the test PDF writer, so no third-party file is involved. The files
 * are committed; run this only to change them.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPdf } from "../../test/pdf-builder.ts";

const outDir = fileURLToPath(
	new URL("../../test/fixtures/pdf/", import.meta.url),
);

const lines = [
	"The first page says one thing at some length so that the file has real content.",
	"The second line of the first page says another thing, again at some length.",
];
const pages = [0, 1, 2].map(() => ({
	runs: lines.map((text, index) => ({ x: 72, y: 700 - index * 14, text })),
}));

// 1. Cut off at 80 percent: the cross-reference table and trailer are gone.
const whole = buildPdf({ pages });
writeFileSync(
	join(outDir, "truncated.pdf"),
	whole.slice(0, Math.floor(whole.length * 0.8)),
);

// 2. Bytes that are not a PDF at all, with a PDF name.
writeFileSync(
	join(outDir, "not-a-pdf.pdf"),
	Uint8Array.from({ length: 600 }, (_, i) => (i * 131 + 7) & 255),
);

// 3. Locked with a security handler that is not the standard one (same length, so the
// cross-reference table stays right).
const locked = buildPdf({ pages, encrypt: { userPassword: "x" } });
const text = Buffer.from(locked).toString("latin1");
writeFileSync(
	join(outDir, "locked-other-scheme.pdf"),
	Buffer.from(text.replace("/Filter /Standard", "/Filter /AdbePubS"), "latin1"),
);
