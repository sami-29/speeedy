import "fake-indexeddb/auto";
import type { LauncherPage } from "@speeedy/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { parseTrustedOrigins } from "../src/lib/launcher/config.ts";
import { saveLauncherPage } from "../src/lib/launcher/save.ts";
import {
	createLibraryStore,
	LIBRARY_DB_NAME,
	type LibraryStore,
} from "../src/lib/library/store.ts";

let counter = 0;
const opened: LibraryStore[] = [];
const open = () => {
	const store = createLibraryStore({
		name: `${LIBRARY_DB_NAME}-launcher-${++counter}`,
	});
	opened.push(store);
	return store;
};
afterEach(() => {
	for (const store of opened.splice(0)) store.close();
});

const page = (overrides: Partial<LauncherPage> = {}): LauncherPage => ({
	type: "speeedy:page",
	version: 1,
	title: "A fine article",
	url: "https://news.example/story?id=7",
	language: "en",
	document: {
		version: 1,
		blocks: [
			{ kind: "heading", level: 1, text: "A fine article", spans: [] },
			{
				kind: "paragraph",
				text: "The first paragraph of the story.",
				spans: [],
			},
		],
	},
	...overrides,
});

describe("saveLauncherPage", () => {
	it("keeps the page in the Library with its title and a source URL kept on the device", async () => {
		const store = open();
		const { id } = await saveLauncherPage(store, page());
		const loaded = await store.load(id);
		expect(loaded?.meta).toMatchObject({
			title: "A fine article",
			sourceUrl: "https://news.example/story?id=7",
			language: "en",
			source: "own",
			deviceOnly: false,
		});
		expect(loaded?.document.blocks).toHaveLength(2);
	});

	it("makes it the document the reader resumes", async () => {
		const store = open();
		const { id } = await saveLauncherPage(store, page());
		expect(await store.currentId()).toBe(id);
	});

	it("titles an untitled page from its opening words", async () => {
		const store = open();
		const { id } = await saveLauncherPage(store, page({ title: "  " }));
		expect((await store.get(id))?.title).toBe("A fine article");
	});

	it("keeps the same page once, however often it is sent", async () => {
		const store = open();
		const first = await saveLauncherPage(store, page());
		const again = await saveLauncherPage(
			store,
			page({ url: "https://other.example/copy" }),
		);
		expect(again.id).toBe(first.id);
		expect(await store.list()).toHaveLength(1);
	});

	it("does not touch the network", async () => {
		const store = open();
		const original = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = (() => {
			calls++;
			return Promise.reject(new Error("no network"));
		}) as typeof fetch;
		try {
			await saveLauncherPage(store, page());
		} finally {
			globalThis.fetch = original;
		}
		expect(calls).toBe(0);
	});
});

describe("parseTrustedOrigins", () => {
	it("reads a comma-separated list of extension origins", () => {
		const id = "a".repeat(32);
		expect(
			parseTrustedOrigins(`chrome-extension://${id}, moz-extension://*`),
		).toEqual([`chrome-extension://${id}`, "moz-extension://*"]);
	});

	it("drops anything that is not an extension origin, so a typo cannot trust a website", () => {
		expect(
			parseTrustedOrigins(
				"https://evil.example,*,chrome-extension://short,chrome-extension://*,http://localhost,,",
			),
		).toEqual([]);
	});

	it("trusts nobody when nothing is configured, so a build with the variable unset fails closed", () => {
		expect(parseTrustedOrigins(undefined)).toEqual([]);
	});

	it("reads an ask entry for a Chromium ID and nothing else after ask:", () => {
		const id = "c".repeat(32);
		expect(parseTrustedOrigins(`ask:chrome-extension://${id}`)).toEqual([
			`ask:chrome-extension://${id}`,
		]);
		expect(
			parseTrustedOrigins("ask:https://evil.example,ask:moz-extension://*"),
		).toEqual([]);
	});

	it("trusts nobody when the list is configured empty", () => {
		expect(parseTrustedOrigins("")).toEqual([]);
	});
});
