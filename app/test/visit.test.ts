import { describe, expect, it } from "vitest";
import { readVisit } from "../src/lib/visit.ts";

const web = (
	href: string,
	extra: Partial<Parameters<typeof readVisit>[0]> = {},
) => readVisit({ href, referrer: "", standalone: false, ...extra });

describe("the Visit's ref", () => {
	it("keeps an allowlisted ref and takes it out of the address", () => {
		const { context, cleanHref } = web("https://speeedy.app/?ref=hn");
		expect(context.ref).toBe("hn");
		expect(cleanHref).toBe("https://speeedy.app/");
	});

	it("sends a ref off the list as other, and still takes it out", () => {
		const { context, cleanHref } = web(
			"https://speeedy.app/?ref=somebody-else",
		);
		expect(context.ref).toBe("other");
		expect(cleanHref).toBe("https://speeedy.app/");
	});

	it("has no ref and no address change when there was no ref", () => {
		const { context, cleanHref } = web("https://speeedy.app/reader");
		expect(context.ref).toBeUndefined();
		expect(cleanHref).toBeUndefined();
	});

	it("leaves every other parameter and the hash alone", () => {
		const { context, cleanHref } = web(
			"https://speeedy.app/reader?title=A&ref=reddit-studytips&text=B#top",
		);
		expect(context.ref).toBe("reddit-studytips");
		expect(cleanHref).toBe("https://speeedy.app/reader?title=A&text=B#top");
	});

	it("takes every ref parameter out and uses the first", () => {
		const { context, cleanHref } = web(
			"https://speeedy.app/?ref=ph&ref=hn&x=1",
		);
		expect(context.ref).toBe("ph");
		expect(cleanHref).toBe("https://speeedy.app/?x=1");
	});

	it("never lets a ref carry text onward", () => {
		const { context } = web(
			"https://speeedy.app/?ref=CANARY-document-text-7f3a9c",
		);
		expect(JSON.stringify(context)).not.toContain("CANARY");
		expect(context.ref).toBe("other");
	});
});

describe("the Visit's surface", () => {
	it("is web in a plain browser tab", () => {
		expect(web("https://speeedy.app/").context.surface).toBe("web");
	});

	it("is pwa in an installed app window", () => {
		expect(
			web("https://speeedy.app/", { standalone: true }).context.surface,
		).toBe("pwa");
	});

	it("is twa when Android opened it, which sets the referrer to the app", () => {
		const { context } = web("https://speeedy.app/", {
			referrer: "android-app://app.speeedy.twa/",
			standalone: true,
		});
		expect(context.surface).toBe("twa");
	});

	it("is share-link when the first page is a Share Link", () => {
		expect(web("https://speeedy.app/s#1.abc").context.surface).toBe(
			"share-link",
		);
	});

	it("puts the installed surfaces before share-link", () => {
		expect(
			web("https://speeedy.app/s#1.abc", { standalone: true }).context.surface,
		).toBe("pwa");
	});

	it("does not take a web referrer for the TWA", () => {
		expect(
			web("https://speeedy.app/", { referrer: "https://news.ycombinator.com/" })
				.context.surface,
		).toBe("web");
	});
});
