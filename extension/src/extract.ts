import { Readability } from "@mozilla/readability";
import {
	type Block,
	blockText,
	cleanLinkHref,
	type Document,
	LAUNCHER_LIMITS,
	LAUNCHER_VERSION,
	type LauncherLimits,
	type LauncherPage,
	type Span,
	validateLauncherPage,
} from "@speeedy/contracts";
import { normalizeLanguageTag, parse } from "@speeedy/parsers";

export type ExtractFailure = "not-web-page" | "empty" | "too-big";

export type ExtractResult =
	| { ok: true; page: LauncherPage }
	| { ok: false; reason: ExtractFailure };

/** Readability gives up past this many elements instead of freezing the tab. */
const MAX_ELEMENTS = 200_000;

const isWebAddress = (url: string): boolean => {
	try {
		const { protocol } = new URL(url);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
};

/** The address without its fragment, which can hold a reader's place or a token. The query stays. */
function withoutFragment(url: string): string {
	const address = new URL(url);
	address.hash = "";
	return address.href;
}

/**
 * A link whose target the app would refuse (a relative path, a fragment, a script scheme)
 * becomes plain text, so one odd link cannot make the app refuse the whole page.
 */
function keepOnlyLinksTheAppTakes(document: Document): Document {
	const blocks: Block[] = document.blocks.map((block) => {
		if (block.kind === "image-placeholder") return block;
		if (!block.spans.some((span) => span.kind === "link")) return block;
		const spans = block.spans.flatMap((span): Span[] => {
			if (span.kind !== "link") return [span];
			const href = cleanLinkHref(span.href);
			return href === null ? [] : [{ ...span, href }];
		});
		return { ...block, spans };
	});
	return { ...document, blocks };
}

/** The article as HTML, or null when Readability finds none or the page is too large for it. */
function readArticle(
	dom: globalThis.Document,
): { title: string; content: string } | "too-big" | null {
	try {
		// Readability edits the document it is given, so it gets a copy and the page stays as is.
		const copy = dom.cloneNode(true) as globalThis.Document;
		const article = new Readability(copy, {
			maxElemsToParse: MAX_ELEMENTS,
		}).parse();
		if (!article?.content) return null;
		return { title: article.title ?? "", content: article.content };
	} catch {
		return "too-big";
	}
}

/**
 * Turn the page the reader is looking at into the message Speeedy's Library takes. Readability
 * picks the article out of the page; the same HTML parser the app uses turns it into a
 * Document, so a page reads the same as a saved web page. When Readability finds no article,
 * the page's own text is used. A page over the caps is refused, never cut short.
 */
export async function extractPage(
	source: { dom: globalThis.Document; url: string },
	options: { limits?: Partial<LauncherLimits> } = {},
): Promise<ExtractResult> {
	const limits: LauncherLimits = { ...LAUNCHER_LIMITS, ...options.limits };
	const { dom, url } = source;
	if (!isWebAddress(url)) return { ok: false, reason: "not-web-page" };

	const hint = normalizeLanguageTag(dom.documentElement.lang) ?? undefined;
	const hints = hint ? { language: hint } : undefined;

	const article = readArticle(dom);
	if (article === "too-big") return { ok: false, reason: "too-big" };

	let outcome = article
		? await parse(new TextEncoder().encode(article.content), "page.html", hints)
		: null;
	if (!outcome?.ok) {
		// No article: read what the page shows, through the same parser. It skips script, style,
		// noscript and template text, which is where a page keeps data that is not for reading.
		outcome = await parse(
			new TextEncoder().encode(dom.body?.outerHTML ?? ""),
			"page.html",
			hints,
		);
	}
	if (!outcome.ok) {
		return {
			ok: false,
			reason: outcome.reason === "too-big" ? "too-big" : "empty",
		};
	}

	const document = keepOnlyLinksTheAppTakes(outcome.document);
	const { blocks } = document;
	let characters = 0;
	for (const block of blocks) characters += blockText(block).length;
	if (blocks.length > limits.blocks || characters > limits.characters) {
		return { ok: false, reason: "too-big" };
	}

	const title = (article?.title || dom.title || outcome.title || "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limits.title);
	const checked = validateLauncherPage({
		type: "speeedy:page",
		version: LAUNCHER_VERSION,
		title,
		url: withoutFragment(url),
		language: outcome.language.code,
		document,
	});
	if (!checked.ok) {
		return {
			ok: false,
			reason: checked.reason === "too-big" ? "too-big" : "empty",
		};
	}
	return { ok: true, page: checked.page };
}
