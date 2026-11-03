/**
 * Builds the three LibreOffice-made PDF fixtures in `test/fixtures/pdf/` and the plain-text
 * source of each (`<name>.paragraphs.json`, the paragraphs a correct parser must give back).
 *
 *   node packages/parsers/fixtures-src/pdf/build.mts <work dir>
 *
 * All text is written here, so the files carry no licence question. The text is shuffled
 * by a seeded generator, so the output is the same on every run. The PDFs themselves are
 * committed; run this only to change them. It needs `soffice` (LibreOffice) on the path.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPdf } from "../../test/pdf-builder.ts";

const work = process.argv[2];
if (!work) throw new Error("usage: build.mts <work dir>");
const outDir = fileURLToPath(
	new URL("../../test/fixtures/pdf/", import.meta.url),
);
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });

function rng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SENTENCES = [
	"Participants read short passages on a screen while a camera recorded the movement of their eyes.",
	"The experimental procedure was explained in advance, and every participant gave written consent.",
	"A well-known result in this field is that comprehension falls when the presentation rate is raised beyond a personal limit.",
	"Self-paced reading gives the reader control, but it also hides the moments where attention drifts.",
	"The distribution of fixation durations was strongly skewed, with a long tail of unusually slow responses.",
	"Short function words were often skipped, while long and unfamiliar words attracted several fixations.",
	"We compared three conditions that differed only in how quickly the next word appeared.",
	"Performance on the comprehension questions was measured immediately after each passage and again a week later.",
	"Younger readers adapted to the faster condition within a few minutes of practice.",
	"Older participants preferred a slower rhythm, and their accuracy stayed high throughout the session.",
	"The long-term effect of training remains uncertain because the follow-up period was short.",
	"Typography had a measurable influence, and a larger typeface improved accuracy for the weakest readers.",
	"Several explanations are possible, and the present data cannot separate them with confidence.",
	"An important limitation is that the sample was drawn from a single university population.",
	"Further investigation should examine whether the same pattern holds for unfamiliar technical material.",
	"Interruptions were rare, but when they occurred the reader usually returned to the start of the sentence.",
	"The measurement apparatus was calibrated before every block, and unreliable trials were removed.",
	"Subjective ratings of effort rose steadily as the presentation rate increased.",
	"A high-frequency word is recognised faster than a rare one, even when both sit in the same position.",
	"Taken together, these observations support a simple account based on limited working memory.",
	"The correlation between reading speed and accuracy was weak and varied across individuals.",
	"Results are summarised in the accompanying figures, and detailed tables are available on request.",
	"Readers who skimmed the opening paragraph tended to perform better on questions about the main argument.",
	"Instructions were identical for all groups, and the order of the conditions was balanced across participants.",
	"Notably, the slowest readers were not the least accurate, which argues against a simple trade-off.",
	"Environmental noise was kept below a fixed level, and the room lighting did not change between sessions.",
	"The analysis used a mixed-effects model with random intercepts for both participants and passages.",
	"Where the model failed to converge, the simplest random structure that converged was reported instead.",
];

const HEADINGS = [
	"1 Introduction",
	"2 Method",
	"2.1 Participants",
	"2.2 Procedure",
	"3 Results",
	"3.1 Accuracy",
	"3.2 Reading rate",
	"4 Discussion",
	"5 Conclusion",
];

function pick(random: () => number, count: number): string[] {
	const pool = [...SENTENCES];
	const out: string[] = [];
	for (let i = 0; i < count; i++) {
		const index = Math.floor(random() * pool.length);
		out.push(pool.splice(index, 1)[0] ?? "");
	}
	return out;
}

/** Paragraph k opens with a sentence unique to it, so a misplaced paragraph is visible. */
function paragraph(random: () => number, k: number, sentences: number): string {
	const lead = `Observation ${k} concerns block ${((k * 7) % 11) + 1} of the study.`;
	return [lead, ...pick(random, sentences)].join(" ");
}

const esc = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Doc = {
	name: string;
	pageWidth: string;
	pageHeight: string;
	margins: string;
	mirrored: boolean;
	body: string;
	headerRight: string;
	headerLeft?: string;
	footer: string;
	paragraphs: string[];
};

function fodt(doc: Doc): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:font-face-decls>
<style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman"/>
<style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss"/>
</office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:hyphenation-ladder-count="no-limit"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph"><style:text-properties style:font-name="Liberation Serif" fo:font-size="10pt" fo:language="en" fo:country="US"/></style:style>
<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.3cm"/><style:text-properties fo:font-size="17pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Authors" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.5cm"/><style:text-properties fo:font-size="11pt"/></style:style>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0.35cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always"/><style:text-properties style:font-name="Liberation Sans" fo:font-size="11.5pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Chapter" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.5cm"/><style:text-properties style:font-name="Liberation Sans" fo:font-size="22pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Body" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="justify" fo:text-indent="0.55cm" fo:margin-top="0cm" fo:margin-bottom="0cm" fo:hyphenate="true" fo:hyphenation-remain-char-count="2" fo:hyphenation-push-char-count="2" fo:orphans="1" fo:widows="1"/><style:text-properties fo:font-size="${doc.body}"/></style:style>
<style:style style:name="Spaced" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="start" fo:text-indent="0cm" fo:margin-top="0cm" fo:margin-bottom="0.32cm" fo:hyphenate="true" fo:hyphenation-remain-char-count="2" fo:hyphenation-push-char-count="2" fo:orphans="1" fo:widows="1"/><style:text-properties style:font-name="Liberation Sans" fo:font-size="${doc.body}"/></style:style>
<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="8.5pt" fo:font-style="italic"/></style:style>
<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="8.5pt"/></style:style>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1"${doc.mirrored ? ' style:page-usage="mirrored"' : ""}>
<style:page-layout-properties fo:page-width="${doc.pageWidth}" fo:page-height="${doc.pageHeight}" fo:margin-top="1.2cm" fo:margin-bottom="1.2cm" fo:margin-left="${doc.margins}" fo:margin-right="${doc.margins}"/>
<style:header-style><style:header-footer-properties fo:min-height="0.5cm" fo:margin-bottom="0.7cm"/></style:header-style>
<style:footer-style><style:header-footer-properties fo:min-height="0.5cm" fo:margin-top="0.7cm"/></style:footer-style>
</style:page-layout>
<style:style style:name="OneCol" style:family="section"><style:section-properties><style:columns fo:column-count="1" fo:column-gap="0cm"/></style:section-properties></style:style>
<style:style style:name="TwoCol" style:family="section"><style:section-properties><style:columns fo:column-count="2" fo:column-gap="0.8cm"/></style:section-properties></style:style>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Standard" style:page-layout-name="pm1">
<style:header><text:p text:style-name="Header">${esc(doc.headerRight)}</text:p></style:header>
${doc.headerLeft ? `<style:header-left><text:p text:style-name="Header">${esc(doc.headerLeft)}</text:p></style:header-left>` : ""}
<style:footer><text:p text:style-name="Footer">${doc.footer}</text:p></style:footer>
${doc.mirrored ? `<style:footer-left><text:p text:style-name="Footer">${doc.footer}</text:p></style:footer-left>` : ""}
</style:master-page>
</office:master-styles>
<office:body><office:text>
BODY
</office:text></office:body>
</office:document>
`;
}

function run(doc: Doc, bodyXml: string) {
	const base = join(work, doc.name);
	writeFileSync(`${base}.fodt`, fodt(doc).replace("BODY", bodyXml));
	execFileSync(
		"soffice",
		[
			`-env:UserInstallation=file://${join(work, "profile")}`,
			"--headless",
			"--convert-to",
			"pdf",
			"--outdir",
			work,
			`${base}.fodt`,
		],
		{ stdio: "pipe" },
	);
	copyFileSync(`${base}.pdf`, join(outDir, `${doc.name}.pdf`));
	writeFileSync(
		fileURLToPath(new URL(`./${doc.name}.paragraphs.json`, import.meta.url)),
		`${JSON.stringify(doc.paragraphs, null, "\t")}\n`,
	);
}

/**
 * LibreOffice here has no hyphenation dictionary loaded, so long words get soft hyphens at
 * plausible syllable points. Writer shows a real hyphen only where it breaks a line, which
 * is how most typeset PDFs end up with "exam-" at the end of a line.
 */
function softHyphens(text: string): string {
	return text.replace(/[a-z]{8,}/g, (word) => {
		let out = "";
		for (let i = 0; i < word.length; i++) {
			out += word[i];
			const isVowel = (c: string | undefined) => !!c && "aeiouy".includes(c);
			if (
				i >= 2 &&
				i <= word.length - 4 &&
				isVowel(word[i]) &&
				!isVowel(word[i + 1]) &&
				isVowel(word[i + 2])
			) {
				out += "­";
			}
		}
		return out;
	});
}

const p = (style: string, text: string) =>
	`<text:p text:style-name="${style}">${esc(
		style === "Body" || style === "Spaced" ? softHyphens(text) : text,
	)}</text:p>`;

// 1. A two-column paper: title block across both columns, running head, "Page N of M".
{
	const random = rng(11);
	const paragraphs: string[] = [];
	let xml = `<text:section text:name="Top" text:style-name="OneCol">`;
	const title = "Paced Reading and Sustained Attention: A Pilot Study";
	xml += p("Title", title);
	xml += p("Authors", "A. Researcher and B. Colleague");
	const abstract =
		"Abstract. We describe a pilot study of paced reading in which every word appeared for a fixed time. Comprehension stayed stable at moderate rates and fell sharply once the rate passed a personal limit. The comprehension results, the reading times and the ratings of effort are reported together.";
	xml += p("Body", abstract);
	xml += `</text:section><text:section text:name="Cols" text:style-name="TwoCol">`;
	let k = 1;
	for (const heading of HEADINGS) {
		xml += p("Heading", heading);
		paragraphs.push(heading);
		for (let i = 0; i < 3; i++) {
			const text = paragraph(random, k++, 5);
			xml += p("Body", text);
			paragraphs.push(text);
		}
	}
	xml += "</text:section>";
	run(
		{
			name: "paper-two-column",
			pageWidth: "21.59cm",
			pageHeight: "27.94cm",
			margins: "1.9cm",
			mirrored: false,
			body: "10pt",
			headerRight: "Paced Reading and Sustained Attention",
			footer: `Page <text:page-number text:select-page="current">1</text:page-number> of <text:page-count>3</text:page-count>`,
			paragraphs: [
				title,
				"A. Researcher and B. Colleague",
				abstract,
				...paragraphs,
			],
		},
		xml,
	);
}

// 2. Textbook pages: one column, indented paragraphs, alternating running heads.
{
	const random = rng(23);
	const paragraphs: string[] = [];
	let xml = "";
	const chapter = "Chapter 3 Measuring Attention";
	xml += p("Chapter", chapter);
	paragraphs.push(chapter);
	let k = 1;
	for (const heading of [
		"3.1 Why we measure",
		"3.2 Sampling methods",
		"3.3 Reading the results",
		"3.4 Common mistakes",
	]) {
		xml += p("Heading", heading);
		paragraphs.push(heading);
		for (let i = 0; i < 4; i++) {
			const text = paragraph(random, k++, 6);
			xml += p("Body", text);
			paragraphs.push(text);
		}
	}
	run(
		{
			name: "textbook-pages",
			pageWidth: "15.24cm",
			pageHeight: "22.86cm",
			margins: "2cm",
			mirrored: true,
			body: "11pt",
			headerRight: "3.2 Sampling methods",
			headerLeft: "Measuring Attention",
			footer: `<text:page-number text:select-page="current">1</text:page-number>`,
			paragraphs,
		},
		xml,
	);
}

// 3. An article with block paragraphs (space between them, no indent) and a dashed footer.
{
	const random = rng(37);
	const paragraphs: string[] = [];
	let xml = "";
	const title = "Notes on Reading Speed";
	xml += p("Title", title);
	paragraphs.push(title);
	for (let k = 1; k <= 14; k++) {
		const text = paragraph(random, k, 4);
		xml += p("Spaced", text);
		paragraphs.push(text);
	}
	run(
		{
			name: "article-block-paragraphs",
			pageWidth: "21cm",
			pageHeight: "29.7cm",
			margins: "2.5cm",
			mirrored: false,
			body: "11pt",
			headerRight: "Reading Notes - Internal Draft",
			footer: `- <text:page-number text:select-page="current">1</text:page-number> -`,
			paragraphs,
		},
		xml,
	);
}

// 4. A scan: one picture of a page of text, no text layer at all (ImageMagick).
execFileSync(
	"convert",
	[
		...["-size", "612x792", "xc:white", "-fill", "black", "-pointsize", "18"],
		...["-annotate", "+60+100", "A page that was scanned."],
		...["-annotate", "+60+140", "It is only a picture of text,"],
		...["-annotate", "+60+180", "so there is nothing to select."],
		...["-density", "72", "-compress", "zip"],
		join(outDir, "scanned-page.pdf"),
	],
	{ stdio: "pipe" },
);

// 5. Small generated files: locked, locked only for editing, and a page with nothing on it.
const sample = [
	{ x: 72, y: 700, text: "This sentence is the whole of the document." },
];
writeFileSync(
	join(outDir, "locked-user-password.pdf"),
	buildPdf({
		pages: [{ runs: sample }],
		encrypt: { userPassword: "open sesame" },
	}),
);
writeFileSync(
	join(outDir, "locked-owner-password-only.pdf"),
	buildPdf({
		pages: [{ runs: sample }],
		encrypt: { userPassword: "", ownerPassword: "owner" },
	}),
);
writeFileSync(join(outDir, "blank-page.pdf"), buildPdf({ pages: [{}] }));

console.log(readdirSync(outDir).join("\n"));
