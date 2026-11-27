import { expect, type Page, test } from "@playwright/test";

type Sent = { event: string; properties: Record<string, unknown> };

const CANARY = "CANARY-document-text-7f3a9c";
const TEXT = `one two three four five six seven eight nine ten ${"more ".repeat(60)}`;

/** Collects what the page posts to /api/e, and every request body it sends anywhere. */
async function capture(page: Page) {
	const events: Sent[] = [];
	const bodies: string[] = [];
	const urls: string[] = [];
	page.on("request", (request) => {
		urls.push(request.url());
		const body = request.postData();
		if (body) bodies.push(body);
	});
	await page.route("**/api/e", async (route) => {
		const body = route.request().postDataJSON() as { events: Sent[] };
		events.push(...body.events);
		await route.fulfill({ status: 204 });
	});
	return { events, bodies, urls };
}

/** The events of one name, without the `exp_` variants every event carries beside its own properties. */
const named = (events: Sent[], name: string): Sent[] =>
	events
		.filter((e) => e.event === name)
		.map((e) => ({
			event: e.event,
			properties: Object.fromEntries(
				Object.entries(e.properties).filter(([key]) => !key.startsWith("exp_")),
			),
		}));

async function startReading(page: Page, text = TEXT) {
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(page.getByTestId("word")).toHaveText(/\S/);
}

test.describe("session_started", () => {
	test("carries the allowlisted ref, the surface and the source, and the ref leaves the address", async ({
		page,
	}) => {
		const { events } = await capture(page);
		await page.goto("/?ref=hn");
		await expect(page).toHaveURL(/^[^?#]*$/);
		await startReading(page);
		await expect
			.poll(() => named(events, "session_started").length, {
				timeout: 10_000,
			})
			.toBe(1);
		expect(named(events, "session_started")[0]?.properties).toMatchObject({
			source: "own",
			surface: "web",
			ref: "hn",
			first_this_month: true,
			days_since_first: "0",
			lifetime_sessions: "1",
		});
		expect(page.url()).not.toContain("ref=");
	});

	test("sends a ref off the list as other and never the value", async ({
		page,
	}) => {
		const { events, bodies } = await capture(page);
		await page.goto(`/?ref=${CANARY}`);
		await startReading(page);
		await expect
			.poll(() => named(events, "session_started").length, {
				timeout: 10_000,
			})
			.toBe(1);
		expect(named(events, "session_started")[0]?.properties.ref).toBe("other");
		expect(page.url()).not.toContain("CANARY");
		expect(bodies.join("\n")).not.toContain(CANARY);
	});

	test("has no ref property when the address had none", async ({ page }) => {
		const { events } = await capture(page);
		await page.goto("/reader");
		await startReading(page);
		await expect
			.poll(() => named(events, "session_started").length, {
				timeout: 10_000,
			})
			.toBe(1);
		const { properties } = named(events, "session_started")[0] as Sent;
		expect(properties).not.toHaveProperty("ref");
		expect(properties).toMatchObject({ surface: "web", source: "own" });
	});

	test("sends one start per Session, not one per pause", async ({ page }) => {
		const { events } = await capture(page);
		await page.goto("/reader");
		await startReading(page);
		await page.getByRole("button", { name: "Pause" }).click();
		await page.getByRole("button", { name: "Play" }).click();
		await page.getByRole("button", { name: "Pause" }).click();
		await page.waitForTimeout(2500);
		expect(named(events, "session_started")).toHaveLength(1);
	});

	test("sends nothing but enums and flags", async ({ page }) => {
		const { events, bodies } = await capture(page);
		await page.goto("/?ref=hn");
		await startReading(page, `${CANARY} ${TEXT}`);
		await expect
			.poll(() => named(events, "session_started").length, {
				timeout: 10_000,
			})
			.toBe(1);
		const { properties } = named(events, "session_started")[0] as Sent;
		for (const value of Object.values(properties)) {
			expect(["string", "boolean"]).toContain(typeof value);
		}
		expect(Object.keys(properties).sort()).toEqual(
			[
				"days_since_first",
				"first_this_month",
				"lifetime_sessions",
				"ref",
				"source",
				"surface",
			].sort(),
		);
		expect(bodies.join("\n")).not.toContain(CANARY);
	});
});

test.describe("importing files", () => {
	test("sends file_uploaded with the format and nothing about the file", async ({
		page,
	}) => {
		const { events, bodies } = await capture(page);
		await page.goto("/reader");
		await page.getByLabel("Choose a file").setInputFiles({
			name: `${CANARY}.txt`,
			mimeType: "text/plain",
			buffer: Buffer.from(`${CANARY} ${TEXT}`),
		});
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		await expect
			.poll(() => named(events, "session_started").length, {
				timeout: 10_000,
			})
			.toBe(1);
		expect(named(events, "file_uploaded")).toEqual([
			{ event: "file_uploaded", properties: { format: "txt" } },
		]);
		expect(named(events, "parse_failed")).toEqual([]);
		// A Session sends its start and its import: at most 2 events, not counting the pageview.
		expect(events.filter((e) => e.event !== "$pageview")).toHaveLength(2);
		expect(bodies.join("\n")).not.toContain(CANARY);
	});

	test("sends parse_failed with the reason for a file that cannot be read", async ({
		page,
	}) => {
		const { events, bodies } = await capture(page);
		await page.goto("/reader");
		await page.getByLabel("Choose a file").setInputFiles({
			name: `${CANARY}.txt`,
			mimeType: "text/plain",
			buffer: Buffer.from("   \n  "),
		});
		await expect(page.getByRole("alert")).toBeVisible();
		await expect
			.poll(() => named(events, "parse_failed").length, { timeout: 10_000 })
			.toBe(1);
		expect(named(events, "parse_failed")[0]).toEqual({
			event: "parse_failed",
			properties: { reason: "empty" },
		});
		expect(named(events, "file_uploaded")).toEqual([]);
		expect(named(events, "session_started")).toEqual([]);
		expect(bodies.join("\n")).not.toContain(CANARY);
	});

	test("pasted text reports no import", async ({ page }) => {
		const { events } = await capture(page);
		await page.goto("/reader");
		await startReading(page);
		await page.waitForTimeout(2500);
		expect(named(events, "file_uploaded")).toEqual([]);
		expect(named(events, "parse_failed")).toEqual([]);
	});
});
