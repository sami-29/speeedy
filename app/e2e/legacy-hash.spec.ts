import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { CANARY } from "@speeedy/contracts";

// The 1.x encoder from src/components/promote-page.ts on main, copied into the test only.
const legacyEncode = (text: string) =>
	Buffer.from(text, "utf8").toString("base64url");

type Sent = { event: string; properties: Record<string, unknown> };

async function captureEvents(context: BrowserContext): Promise<Sent[]> {
	const events: Sent[] = [];
	await context.route("**/api/e", async (route) => {
		const body = route.request().postDataJSON() as { events: Sent[] };
		events.push(...body.events);
		await route.fulfill({ status: 204 });
	});
	return events;
}

// Every 1.x route in the ticket's table, and the 2.0 path it must end on. A target that a
// later ticket builds (/reading-speed-test, /support, /share-link, /changelog) is checked by
// URL only: the mapper's job is to land on the right address.
const rows: [string, string][] = [
	["/#/", "/"],
	["/#/app", "/library"],
	["/#/profile", "/library"],
	["/#/reader", "/reader"],
	["/#/stats", "/stats"],
	["/#/benchmark", "/reading-speed-test"],
	["/#/learn", "/learn"],
	["/#/donate", "/support"],
	["/#/promote", "/share-link"],
	["/#/privacy", "/privacy"],
	["/#/terms", "/terms"],
	["/#/changelog", "/changelog"],
	["/#/share/JTdCJTIyc2NvcmUlMjI", "/"],
	["/#/nope", "/"],
	["/#app", "/library"],
	["/#benchmark", "/reading-speed-test"],
];

test.describe("1.x hash routes", () => {
	for (const [from, to] of rows) {
		test(`${from} lands on ${to}`, async ({ page }) => {
			await page.goto(from);
			await expect(page).toHaveURL(to === "/" ? /\/$/ : new RegExp(`${to}$`));
			expect(new URL(page.url()).hash).toBe("");
			expect(new URL(page.url()).pathname).toBe(to);
		});
	}

	test("the landing page still renders after #/ or an unknown route", async ({
		page,
	}) => {
		for (const from of ["/#/", "/#/nope", "/#/share/abc"]) {
			await page.goto(from);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expect(page).toHaveURL(/\/$/);
		}
	});

	test("a 1.x bookmark opened in a tab already on the landing page still maps", async ({
		page,
	}) => {
		await page.goto("/");
		await page.evaluate(() => {
			location.hash = "#/benchmark";
		});
		await expect(page).toHaveURL(/\/reading-speed-test$/);
	});

	test("replaces the 1.x entry, so Back does not return to it", async ({
		page,
	}) => {
		await page.goto("/library");
		await page.goto("/#/benchmark");
		await expect(page).toHaveURL(/\/reading-speed-test$/);
		await page.goBack();
		await expect(page).toHaveURL(/\/library$/);
	});

	test("sends one route-only $pageview, for the 2.0 page and never for the 1.x hash", async ({
		context,
		page,
	}) => {
		const events = await captureEvents(context);
		await page.goto("/#/app");
		await expect(page).toHaveURL(/\/library$/);
		await expect
			.poll(() => events.map((e) => e.properties.route), { timeout: 10_000 })
			.toEqual(["/library"]);
		await page.waitForTimeout(800);
		expect(events.map((e) => e.properties.route)).toEqual(["/library"]);
		expect(JSON.stringify(events)).not.toMatch(/#|\/app|benchmark/);
	});

	test("sends one $pageview for / after #/ or an unknown route, with no hash in it", async ({
		context,
		page,
	}) => {
		const events = await captureEvents(context);
		await page.goto("/#/share/SECRET-stats-payload");
		await expect(page).toHaveURL(/\/$/);
		await expect
			.poll(() => events.map((e) => e.properties.route), { timeout: 10_000 })
			.toEqual(["/"]);
		await page.waitForTimeout(800);
		expect(events.map((e) => e.properties.route)).toEqual(["/"]);
		expect(JSON.stringify(events)).not.toContain("SECRET");
	});

	test("runs on / only: other pages keep their hash", async ({ page }) => {
		await page.goto("/library#/app");
		await page.waitForTimeout(500);
		await expect(page).toHaveURL(/\/library#\/app$/);
	});

	test("leaves the skip link and other in-page fragments on the landing page alone", async ({
		page,
	}) => {
		await page.goto("/#main");
		await page.waitForTimeout(500);
		await expect(page).toHaveURL(/\/#main$/);
		await page.goto("/");
		await page.getByRole("link", { name: "Skip to content" }).focus();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/\/#main$/);
	});
});

test.describe("hostile hashes", () => {
	for (const hash of [
		"#/javascript:alert(1)",
		"#//evil.example/phish",
		"#/\\evil.example",
		"#/https://evil.example",
		"#/../../etc/passwd",
		"#/%2e%2e/%2f",
		'#/"><img src=x onerror="window.__pwned=1">',
		"#/__proto__",
		"#/constructor",
		"#/read/<img src=x onerror=window.__pwned=1>",
		`#/${"a".repeat(60_000)}`,
	]) {
		test(`${hash.slice(0, 40)} stays on this site and runs nothing`, async ({
			page,
		}) => {
			const origin = `http://localhost:${process.env.PW_PORT ?? "4173"}`;
			const offsite: string[] = [];
			page.on("request", (request) => {
				if (new URL(request.url()).origin !== origin) {
					offsite.push(request.url());
				}
			});
			await page.goto(`/${hash}`);
			await page.waitForTimeout(500);
			const url = new URL(page.url());
			expect(url.origin).toBe(origin);
			expect(["/", "/s"]).toContain(url.pathname);
			expect(url.search).toBe("");
			expect(
				await page.evaluate(
					() => (window as unknown as { __pwned?: number }).__pwned,
				),
			).toBeUndefined();
			expect(
				await page.evaluate(() => {
					const plain = {} as { path?: unknown; hash?: unknown };
					return [plain.path === undefined, plain.hash === undefined];
				}),
			).toEqual([true, true]);
			expect(offsite).toEqual([]);
		});
	}
});

test.describe("1.x Share Links", () => {
	const TEXT = "alpha beta gamma delta epsilon zeta eta theta";

	test("#/read/ is decoded on the device, rewritten to /s#1. and opened in the reader", async ({
		page,
	}) => {
		const seen: string[] = [];
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) seen.push(frame.url());
		});
		await page.goto(`/#/read/${legacyEncode(TEXT)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("alpha");
		await expect(page.locator("[data-source]")).toHaveAttribute(
			"data-source",
			"share",
		);
		expect(
			seen.some((url) => /\/s#1\./.test(url)),
			`URLs seen: ${seen.map((url) => url.slice(0, 60)).join(" ")}`,
		).toBe(true);
		expect(page.url()).not.toContain("#");
	});

	test("the slash-less #read/ form opens too", async ({ page }) => {
		await page.goto(`/#read/${legacyEncode(TEXT)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("alpha");
	});

	test("non-Latin text arrives intact", async ({ page }) => {
		const text = "Işık ılık süt Съешь ещё булок نص حكيم له سر";
		await page.goto(`/#/read/${legacyEncode(text)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("Işık");
	});

	test("Back does not return to the 1.x link", async ({ page }) => {
		await page.goto("/library");
		await page.goto(`/#/read/${legacyEncode(TEXT)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await page.goBack();
		await expect(page).toHaveURL(/\/library$/);
	});

	for (const [name, hash, message] of [
		["an empty link", "#/read/", "broken or incomplete"],
		["malformed base64", "#/read/%%%", "broken or incomplete"],
		["a link that is not text", "#/read/__79", "broken or incomplete"],
		[
			"a link that is far too long",
			`#/read/${"A".repeat(400_000)}`,
			"too long",
		],
	] as const) {
		test(`${name} shows a plain message on /s`, async ({ page }) => {
			await page.goto(`/${hash}`);
			await expect(page).toHaveURL(/\/s#/);
			await expect(page.getByRole("alert")).toContainText(message);
			await expect(page.getByTestId("word")).toHaveCount(0);
		});
	}

	test("the text, the canary and the link never reach a request, a header or an event", async ({
		context,
		page,
	}) => {
		const events = await captureEvents(context);
		const requests: Promise<string>[] = [];
		context.on("request", (request) => {
			requests.push(
				request
					.allHeaders()
					.then((headers) =>
						[
							request.url(),
							request.postData() ?? "",
							JSON.stringify(headers),
						].join("\n"),
					),
			);
		});
		const responses: Promise<string>[] = [];
		context.on("response", (response) => {
			responses.push(response.allHeaders().then((h) => JSON.stringify(h)));
		});

		const encoded = legacyEncode(`${CANARY} ${TEXT}`);
		await page.goto(`/#/read/${encoded}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		await expect
			.poll(() => events.map((e) => e.properties.route), { timeout: 10_000 })
			.toEqual(expect.arrayContaining(["/s", "/reader"]));
		await page.waitForTimeout(500);

		const sent = await Promise.all(requests);
		expect(sent.length).toBeGreaterThan(0);
		for (const line of [...sent, ...(await Promise.all(responses))]) {
			expect(line).not.toContain(CANARY);
			expect(line).not.toContain(encoded.slice(0, 40));
		}
		for (const line of sent) expect(line).not.toMatch(/"referer":"[^"]*#/);
		const body = JSON.stringify(events);
		expect(body).not.toContain(CANARY);
		expect(body).not.toContain(encoded.slice(0, 40));
		for (const event of events.filter((e) => e.event === "$pageview")) {
			expect(["/s", "/reader"]).toContain(event.properties.route);
		}
	});

	test("the dropped stats payload of #/share/ never reaches a request or an event", async ({
		context,
		page,
	}) => {
		const events = await captureEvents(context);
		const requests: Promise<string>[] = [];
		context.on("request", (request) => {
			requests.push(
				request
					.allHeaders()
					.then((headers) =>
						[
							request.url(),
							request.postData() ?? "",
							JSON.stringify(headers),
						].join("\n"),
					),
			);
		});
		await page.goto("/#/share/Q0FOQVJZLXN0YXRz");
		await expect(page).toHaveURL(/\/$/);
		await expect
			.poll(() => events.length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		await page.waitForTimeout(500);
		for (const line of await Promise.all(requests)) {
			expect(line).not.toContain("Q0FOQVJZ");
		}
		expect(JSON.stringify(events)).not.toContain("Q0FOQVJZ");
	});
});

const viewports = [
	{ name: "390px", width: 390, height: 844 },
	{ name: "desktop", width: 1280, height: 800 },
];

for (const viewport of viewports) {
	test(`axe passes on a broken 1.x link at ${viewport.name}`, async ({
		page,
	}: {
		page: Page;
	}) => {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
		await page.goto("/#/read/__79");
		await expect(page.getByRole("alert")).toContainText("broken or incomplete");
		await page.evaluate(() => document.fonts.ready);
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
			.analyze();
		expect(results.violations).toEqual([]);
	});

	test(`axe passes on the landing page reached from an old link at ${viewport.name}`, async ({
		page,
	}: {
		page: Page;
	}) => {
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height,
		});
		await page.goto("/#/nope");
		await expect(page).toHaveURL(/\/$/);
		await page.evaluate(() => document.fonts.ready);
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
			.analyze();
		expect(results.violations).toEqual([]);
	});
}
