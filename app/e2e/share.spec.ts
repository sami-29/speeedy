import { deflateRawSync, inflateRawSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { CANARY } from "@speeedy/contracts";

// The 1.x encoder from src/components/promote-page.ts on main, copied into the test only.
const legacyEncode = (text: string) =>
	Buffer.from(text, "utf8").toString("base64url");

// Built with Node's zlib, not the app's codec, so the fixtures are independent of it.
const payloadFor = (text: string) =>
	`1.${deflateRawSync(Buffer.from(text, "utf8")).toString("base64url")}`;
const textOf = (payload: string) =>
	inflateRawSync(
		Buffer.from(payload.replace(/^1\./, ""), "base64url"),
	).toString("utf8");

const TEXT = `alpha beta gamma delta ${"more ".repeat(60)}`.trim();

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

async function createLink(page: Page, text: string): Promise<string> {
	await page.goto("/s");
	await page.getByRole("textbox", { name: "Text to share" }).fill(text);
	await page.getByRole("button", { name: "Create Share Link" }).click();
	const link = page.getByRole("textbox", { name: "Share Link", exact: true });
	await expect(link).toHaveValue(/\/s#1\./);
	return link.inputValue();
}

test.describe("creating a Share Link", () => {
	test("puts the compressed text after /s# and opens it in the reader with source share", async ({
		page,
	}) => {
		const link = await createLink(page, TEXT);
		const url = new URL(link);
		expect(url.pathname).toBe("/s");
		expect(textOf(url.hash.slice(1))).toBe(TEXT);

		await page.goto(link);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("alpha");
		await expect(page.locator("[data-source]")).toHaveAttribute(
			"data-source",
			"share",
		);
	});

	test("shared text is attributed and waits for the reader to press Play", async ({
		page,
	}) => {
		await page.goto(`/s#${payloadFor(TEXT)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(
			page.getByText("Shared text from a link. Speeedy didn't write it."),
		).toBeVisible();
		const toggle = page.getByRole("button", { name: "Play" });
		await expect(toggle).toBeVisible();
		await page.waitForTimeout(800);
		await expect(page.getByTestId("word")).toHaveText("alpha");
		await toggle.click();
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
		await expect(page.getByTestId("word")).not.toHaveText("alpha");
	});

	test("opening the same link twice keeps one Library entry, marked as shared", async ({
		page,
	}) => {
		const link = `/s#${payloadFor(TEXT)}`;
		for (let i = 0; i < 2; i++) {
			await page.goto(link);
			await expect(page).toHaveURL(/\/reader$/);
			await expect(page.getByTestId("shared-notice")).toBeVisible();
		}
		await page.goto("/library");
		await expect(page.getByRole("button", { name: /^Read alpha/ })).toHaveCount(
			1,
		);
		const stored = await page.evaluate(
			() =>
				new Promise<{ source: string; deviceOnly: boolean }[]>(
					(resolve, reject) => {
						const request = indexedDB.open("speeedy-library");
						request.onerror = () => reject(request.error);
						request.onsuccess = () => {
							const all = request.result
								.transaction("documents")
								.objectStore("documents")
								.getAll();
							all.onsuccess = () => resolve(all.result);
							all.onerror = () => reject(all.error);
						};
					},
				),
		);
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({ source: "share", deviceOnly: true });
	});

	test("pasted text keeps playing at once, with no attribution", async ({
		page,
	}) => {
		await page.goto("/reader");
		await page.locator("#reader-text").fill(TEXT);
		await page.getByRole("button", { name: "Start", exact: true }).click();
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
		await expect(page.getByText(/Shared text from a link/)).toHaveCount(0);
	});

	test("the skip link on /s leaves the creator intact", async ({ page }) => {
		await page.goto("/s");
		const box = page.getByRole("textbox", { name: "Text to share" });
		await box.fill("kept text");
		await page.getByRole("link", { name: "Skip to content" }).focus();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/\/s#main$/);
		await page.waitForTimeout(300);
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(box).toHaveValue("kept text");
	});

	test("states the size cap and refuses text over it", async ({ page }) => {
		await page.goto("/s");
		const box = page.getByRole("textbox", { name: "Text to share" });
		await box.fill("short text");
		await expect(
			page.getByText(/% of the Share Link size limit/),
		).toBeVisible();

		let seed = 3;
		let long = "";
		for (let i = 0; i < 9000; i++) {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			long += String.fromCharCode(0x4e00 + (seed % 20000));
		}
		await box.fill(long);
		await page.getByRole("button", { name: "Create Share Link" }).click();
		await expect(page.getByRole("alert")).toContainText(
			"Too long for a Share Link",
		);
		await expect(
			page.getByRole("textbox", { name: "Share Link", exact: true }),
		).toHaveCount(0);
	});

	test("asks for text when there is none", async ({ page }) => {
		await page.goto("/s");
		await page.getByRole("button", { name: "Create Share Link" }).click();
		await expect(page.getByRole("alert")).toContainText("Paste some text");
	});
});

test.describe("opening a Share Link", () => {
	test("non-Latin text arrives intact", async ({ page }) => {
		const text = "Işık ılık süt Съешь ещё булок نص حكيم له سر";
		await page.goto(`/s#${payloadFor(text)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("Işık");
	});

	test("a 1.x #/read/ link is decoded on the device and replaced with /s#", async ({
		page,
	}) => {
		const text =
			"Işık ılık ??> ??? Съешь ещё этих булок and more words to read";
		const seen: string[] = [];
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) seen.push(frame.url());
		});
		await page.goto(`/s#/read/${legacyEncode(text)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("Işık");
		await expect(page.locator("[data-source]")).toHaveAttribute(
			"data-source",
			"share",
		);
		const replaced = seen.find((url) => /\/s#1\./.test(url));
		expect(replaced, `URLs seen: ${seen.join(" ")}`).toBeDefined();
		expect(textOf(new URL(replaced as string).hash.slice(1))).toBe(text);
	});

	test("Back does not return to the Share Link", async ({ page }) => {
		await page.goto("/library");
		await page.goto(`/s#${payloadFor(TEXT)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await page.goBack();
		await expect(page).toHaveURL(/\/library$/);
	});

	for (const [name, hash, message] of [
		["malformed base64", "#1.@@not-base64@@", "broken or incomplete"],
		[
			"bytes that are not deflate",
			`#1.${Buffer.from("plain").toString("base64url")}`,
			"broken or incomplete",
		],
		["malformed 1.x base64", "#/read/%%%", "broken or incomplete"],
		["an oversized payload", `#1.${"A".repeat(20_000)}`, "too long to open"],
		[
			"a decompression bomb",
			`#1.${deflateRawSync(Buffer.alloc(8 * 1024 * 1024)).toString("base64url")}`,
			"too long to open",
		],
	] as const) {
		test(`${name} fails with a plain message`, async ({ page }) => {
			await page.goto(`/s${hash}`);
			await expect(page.getByRole("alert")).toContainText(message);
			await expect(page).toHaveURL(/\/s#/);
			await expect(page.getByTestId("word")).toHaveCount(0);
		});
	}

	test("markup in the text is shown as text and never runs", async ({
		page,
	}) => {
		const text =
			'<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script> after';
		await page.goto(`/s#${payloadFor(text)}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText("<img");
		await page.waitForTimeout(500);
		expect(
			await page.evaluate(
				() => (window as unknown as { __pwned?: number }).__pwned,
			),
		).toBeUndefined();
		await expect(page.locator('main img[src="x"], main script')).toHaveCount(0);
	});

	test("a fragment that is no Share Link shows the creator", async ({
		page,
	}) => {
		await page.goto('/s#<img src=x onerror="window.__pwned=1">');
		await expect(
			page.getByRole("textbox", { name: "Text to share" }),
		).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
		expect(
			await page.evaluate(
				() => (window as unknown as { __pwned?: number }).__pwned,
			),
		).toBeUndefined();
	});

	test("markup in a broken link never runs either", async ({ page }) => {
		await page.goto('/s#1.<img src=x onerror="window.__pwned=1">');
		await expect(page.getByRole("alert")).toContainText("broken or incomplete");
		expect(
			await page.evaluate(
				() => (window as unknown as { __pwned?: number }).__pwned,
			),
		).toBeUndefined();
		await expect(page.locator('main img[src="x"]')).toHaveCount(0);
	});
});

test.describe("privacy canary", () => {
	test("the shared text never appears in any request URL, body or header, analytics included", async ({
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

		const text = `${CANARY} ${TEXT}`;
		const link = await createLink(page, text);
		const payload = new URL(link).hash.slice(1);

		const reader = await context.newPage();
		await reader.goto(link);
		await expect(reader).toHaveURL(/\/reader$/);
		await expect(reader.getByTestId("word")).toHaveText(/\S/);
		// Shared text waits for Play; play it so reading itself is captured too.
		await reader.getByRole("button", { name: "Play" }).click();
		await reader.getByRole("button", { name: "Pause" }).click();
		await expect
			.poll(() => events.map((e) => e.properties.route), { timeout: 10_000 })
			.toEqual(expect.arrayContaining(["/s", "/reader"]));

		const sent = await Promise.all(requests);
		expect(sent.length).toBeGreaterThan(0);
		for (const line of [...sent, ...(await Promise.all(responses))]) {
			expect(line).not.toContain(CANARY);
			expect(line).not.toContain(payload);
			expect(line).not.toContain(payload.slice(2, 40));
		}
		for (const line of sent) expect(line).not.toMatch(/"referer":"[^"]*#/);
		const body = JSON.stringify(events);
		expect(body).not.toContain(CANARY);
		expect(body).not.toContain(payload.slice(2, 40));
		for (const event of events.filter((e) => e.event === "$pageview")) {
			expect(["/s", "/reader"]).toContain(event.properties.route);
		}
	});

	test("a 1.x link and a broken link send no text either, analytics and error reports included", async ({
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

		const legacy = legacyEncode(`${CANARY} ${TEXT}`);
		const broken = `${CANARY}-broken`;
		await page.goto(`/s#/read/${legacy}`);
		await expect(page).toHaveURL(/\/reader$/);
		await expect(page.getByTestId("word")).toHaveText(/\S/);
		await page.goto(`/s#1.${broken}`);
		await expect(page.getByRole("alert")).toBeVisible();
		await expect
			.poll(() => events.map((e) => e.properties.route), { timeout: 10_000 })
			.toContain("/s");

		const sent = await Promise.all(requests);
		expect(sent.length).toBeGreaterThan(0);
		for (const line of sent) {
			expect(line).not.toContain(CANARY);
			expect(line).not.toContain(legacy.slice(0, 40));
			expect(line).not.toContain(broken);
		}
		const body = JSON.stringify(events);
		expect(body).not.toContain(CANARY);
		expect(body).not.toContain(legacy.slice(0, 40));
		expect(body).not.toContain(broken);
		expect(events.some((e) => e.event === "$exception")).toBe(false);
	});

	test("/s sets referrer policy no-referrer", async ({ page }) => {
		await page.goto("/s");
		await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
			"content",
			"no-referrer",
		);
	});
});

for (const viewport of [
	{ name: "390px", width: 390, height: 844 },
	{ name: "desktop", width: 1280, height: 800 },
]) {
	test(`axe passes on a created Share Link and a broken one at ${viewport.name}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await createLink(page, TEXT);
		const axe = () =>
			new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
				.analyze();
		expect((await axe()).violations).toEqual([]);
		await page.goto("/s#1.@@");
		await expect(page.getByRole("alert")).toBeVisible();
		expect((await axe()).violations).toEqual([]);
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
}
