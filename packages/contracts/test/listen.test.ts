// `listen_start` carries the document's language as a fixed list and nothing else.
import { describe, expect, it } from "vitest";
import {
	checkEvent,
	clientEvents,
	EVENTS,
	LISTEN_LANGUAGES,
	listenLanguage,
	registryProblems,
} from "../src/index.ts";

const client = clientEvents(EVENTS);

describe("listenLanguage", () => {
	it("keeps the language and drops the region and script", () => {
		expect(listenLanguage("en")).toBe("en");
		expect(listenLanguage("en-GB")).toBe("en");
		expect(listenLanguage("pt_BR")).toBe("pt");
		expect(listenLanguage("zh-Hant-TW")).toBe("zh");
		expect(listenLanguage("FR")).toBe("fr");
	});

	it("maps the other tags for one language onto the listed one", () => {
		expect(listenLanguage("nb")).toBe("no");
		expect(listenLanguage("nn-NO")).toBe("no");
		expect(listenLanguage("iw")).toBe("he");
	});

	it("sends anything unlisted, unknown or not a tag as other", () => {
		expect(listenLanguage("und")).toBe("other");
		expect(listenLanguage("")).toBe("other");
		expect(listenLanguage(undefined)).toBe("other");
		expect(listenLanguage("xx")).toBe("other");
		expect(listenLanguage("a secret sentence from the document")).toBe("other");
	});

	it("only ever returns a value on the list", () => {
		for (const tag of ["en-US", "ja", "und", "tlh", "ru-RU", "ar-EG"]) {
			expect(LISTEN_LANGUAGES).toContain(listenLanguage(tag));
		}
	});
});

describe("listen_start", () => {
	it("is a client event the registry accepts", () => {
		expect(registryProblems(EVENTS)).toEqual([]);
		expect("listen_start" in client).toBe(true);
	});

	it("passes with a listed language", () => {
		const result = checkEvent(client, "listen_start", {
			document_language: "de",
		});
		expect(result.ok).toBe(true);
	});

	it("needs the language, and refuses any value off the list", () => {
		expect(checkEvent(client, "listen_start", {}).ok).toBe(false);
		expect(
			checkEvent(client, "listen_start", { document_language: "en-GB" }).ok,
		).toBe(false);
		expect(
			checkEvent(client, "listen_start", { document_language: "Hello there" })
				.ok,
		).toBe(false);
	});

	it("carries nothing else, so no text and no voice name can ride along", () => {
		for (const extra of ["text", "voice", "title", "sentence"]) {
			expect(
				checkEvent(client, "listen_start", {
					document_language: "en",
					[extra]: "canary",
				}).ok,
			).toBe(false);
		}
	});
});
