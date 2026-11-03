import { describe, expect, it } from "vitest";
import { readShareTarget } from "../src/lib/pwa/share-target.ts";

describe("readShareTarget", () => {
	it("is null when the address carries no share", () => {
		expect(readShareTarget("")).toBeNull();
		expect(readShareTarget("?other=1")).toBeNull();
		expect(readShareTarget("?title=&text=&url=")).toBeNull();
		expect(readShareTarget("?text=%20%20")).toBeNull();
	});

	it("turns shared text into a document text, keeping title and source URL", () => {
		const share = readShareTarget(
			`?${new URLSearchParams({
				title: "A fine article",
				text: "The opening line of the article.",
				url: "https://news.example/story?id=7",
			})}`,
		);
		expect(share).toEqual({
			kind: "text",
			title: "A fine article",
			text: "The opening line of the article.",
			url: "https://news.example/story?id=7",
		});
	});

	it("takes plain text with no title or URL", () => {
		expect(readShareTarget("?text=Just%20some%20words")).toEqual({
			kind: "text",
			title: null,
			text: "Just some words",
			url: null,
		});
	});

	it("finds the URL Android puts in the text and removes it from the text", () => {
		const share = readShareTarget(
			`?${new URLSearchParams({
				title: "Title",
				text: "Worth reading https://news.example/story",
			})}`,
		);
		expect(share).toEqual({
			kind: "text",
			title: "Title",
			text: "Worth reading",
			url: "https://news.example/story",
		});
	});

	it("reports a link with no text as link-only: Speeedy never fetches pages", () => {
		for (const search of [
			`?${new URLSearchParams({ title: "Page", url: "https://news.example/a" })}`,
			`?${new URLSearchParams({ title: "Page", text: "https://news.example/a" })}`,
		])
			expect(readShareTarget(search), search).toEqual({
				kind: "link-only",
				title: "Page",
				url: "https://news.example/a",
			});
	});

	it("keeps only http and https URLs", () => {
		for (const url of [
			"javascript:alert(1)",
			"data:text/html,hi",
			"file:///etc/passwd",
			"ftp://example.com/a",
			"not a url",
		]) {
			const share = readShareTarget(
				`?${new URLSearchParams({ text: "Some words to read", url })}`,
			);
			expect(share, url).toEqual({
				kind: "text",
				title: null,
				text: "Some words to read",
				url: null,
			});
		}
	});

	it("caps the title and the URL at the launcher limits", () => {
		const share = readShareTarget(
			`?${new URLSearchParams({
				title: "t".repeat(400),
				text: "Words",
				url: `https://news.example/${"a".repeat(3000)}`,
			})}`,
		);
		expect(share?.kind).toBe("text");
		if (share?.kind !== "text") return;
		expect(share.title).toHaveLength(300);
		expect(share.url).toBeNull();
	});

	it("reads from a URLSearchParams too", () => {
		const params = new URLSearchParams({ text: "Hello there" });
		expect(readShareTarget(params)).toMatchObject({ text: "Hello there" });
	});
});
