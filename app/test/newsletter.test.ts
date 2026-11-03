import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	newsletterPageFor,
	sendSignup,
	showsFooterForm,
} from "../src/lib/newsletter.ts";

describe("where the footer form shows", () => {
	it("shows on non-reading pages", () => {
		for (const path of [
			"/",
			"/library",
			"/stats",
			"/account",
			"/account/email",
		])
			assert.equal(showsFooterForm(path), true, path);
	});

	it("never shows on a reading surface", () => {
		for (const path of [
			"/reader",
			"/reader/",
			"/training",
			"/training/x",
			"/s",
		])
			assert.equal(showsFooterForm(path), false, path);
	});

	it("leaves pages that carry the full block to that block", () => {
		for (const path of ["/support", "/about", "/changelog"])
			assert.equal(showsFooterForm(path), false, path);
	});
});

describe("the page value of a signup", () => {
	it("names the page and never the path", () => {
		assert.equal(newsletterPageFor("/"), "home");
		assert.equal(newsletterPageFor("/library"), "library");
		assert.equal(newsletterPageFor("/account/email"), "account");
		assert.equal(newsletterPageFor("/support"), "support");
		assert.equal(newsletterPageFor("/anything-else"), "other");
	});
});

describe("sending a signup", () => {
	const signup = {
		email: "a@b.co",
		building: false,
		page: "home",
		website: "",
	} as const;
	const reply = (status: number) => async () => new Response("{}", { status });

	it("maps the Worker's answers", async () => {
		assert.equal(await sendSignup(signup, reply(200)), "sent");
		assert.equal(await sendSignup(signup, reply(429)), "rate_limited");
		assert.equal(await sendSignup(signup, reply(502)), "failed");
		assert.equal(await sendSignup(signup, reply(400)), "failed");
	});

	it("fails quietly when the network does", async () => {
		const down = async () => {
			throw new TypeError("offline");
		};
		assert.equal(await sendSignup(signup, down), "failed");
	});

	it("posts to the same origin without credentials", async () => {
		let seen: { url: unknown; init: RequestInit | undefined } | undefined;
		await sendSignup(signup, async (url, init) => {
			seen = { url, init };
			return new Response("{}", { status: 200 });
		});
		assert.equal(seen?.url, "/api/newsletter");
		assert.equal(seen?.init?.method, "POST");
		assert.equal(seen?.init?.credentials, "omit");
	});
});
