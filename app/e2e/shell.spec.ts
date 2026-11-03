import { expect, test } from "@playwright/test";

const appRoutes = [
	"/reader",
	"/library",
	"/stats",
	"/training",
	"/s",
	"/account",
];

test.describe("landing /", () => {
	test("is prerendered: the headline is in the HTML without JavaScript", async ({
		request,
	}) => {
		const html = await (await request.get("/")).text();
		expect(html).toMatch(/<h1[^>]*>[^<]*Read/);
		expect(html).toContain('lang="en"');
		expect(html).not.toMatch(/name="robots"[^>]*noindex/);
	});

	test("carries the Swiss Reading Poster tokens", async ({ page }) => {
		await page.goto("/");
		// Tailwind minifies hex values (#111111 becomes #111), so resolve each token to rgb.
		const tokens = await page.evaluate(() => {
			const resolve = (name: string) => {
				const probe = document.createElement("i");
				probe.style.color = `var(${name})`;
				document.body.append(probe);
				const color = getComputedStyle(probe).color;
				probe.remove();
				return color;
			};
			return {
				paper: resolve("--color-paper"),
				red: resolve("--color-red"),
				ink: resolve("--color-ink"),
				bodyBackground: getComputedStyle(document.body).backgroundColor,
				bodyColor: getComputedStyle(document.body).color,
			};
		});
		expect(tokens.paper).toBe("rgb(239, 241, 241)");
		expect(tokens.red).toBe("rgb(209, 45, 22)");
		expect(tokens.ink).toBe("rgb(17, 17, 17)");
		expect(tokens.bodyBackground).toBe("rgb(239, 241, 241)");
		expect(tokens.bodyColor).toBe("rgb(17, 17, 17)");
	});

	test("has no radii and no shadows on any element", async ({ page }) => {
		await page.goto("/");
		const offenders = await page.evaluate(() =>
			[...document.querySelectorAll("body *")]
				.filter((el) => {
					const s = getComputedStyle(el);
					return s.borderRadius !== "0px" || s.boxShadow !== "none";
				})
				.map((el) => el.tagName),
		);
		expect(offenders).toEqual([]);
	});

	test("self-hosts Archivo with condensed headlines and wide numerals", async ({
		page,
	}) => {
		const requests: string[] = [];
		page.on("request", (r) => requests.push(r.url()));
		await page.goto("/");
		await page.evaluate(() => document.fonts.ready);
		expect(await page.evaluate(() => document.fonts.check("1em Archivo"))).toBe(
			true,
		);
		expect(requests.some((u) => u.endsWith("/fonts/archivo-wdth.woff2"))).toBe(
			true,
		);
		expect(requests.filter((u) => !u.startsWith("http://localhost"))).toEqual(
			[],
		);
		const variations = await page.evaluate(() => ({
			headline: getComputedStyle(document.querySelector("h1") as Element)
				.fontVariationSettings,
			numeral: getComputedStyle(document.querySelector(".numeral") as Element)
				.fontVariationSettings,
		}));
		expect(variations.headline).toContain('"wdth" 82');
		expect(variations.numeral).toContain('"wdth" 112');
	});

	test("respects reduced motion", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.goto("/");
		const animated = await page.evaluate(
			() =>
				getComputedStyle(document.querySelector("h1") as Element).animationName,
		);
		expect(animated).not.toBe("none");
		await page.emulateMedia({ reducedMotion: "reduce" });
		const still = await page.evaluate(
			() =>
				getComputedStyle(document.querySelector("h1") as Element).animationName,
		);
		expect(still).toBe("none");
	});

	test("stays light even when Night is saved", async ({ page }) => {
		await page.addInitScript(() =>
			localStorage.setItem("speeedy.theme", "night"),
		);
		await page.goto("/");
		expect(
			await page.evaluate(() => document.documentElement.dataset.theme),
		).not.toBe("night");
		expect(
			await page.evaluate(
				() => getComputedStyle(document.body).backgroundColor,
			),
		).toBe("rgb(239, 241, 241)");
	});

	test("fits at 390px with no horizontal scroll", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});

test.describe("app routes", () => {
	for (const route of appRoutes) {
		test(`${route} is a client-only shell with noindex`, async ({
			page,
			request,
		}) => {
			const response = await request.get(route);
			expect(response.status()).toBe(200);
			expect(await response.text()).toMatch(
				/<meta[^>]*name="robots"[^>]*content="noindex"/,
			);
			await page.goto(route);
			await expect(page.locator("main h1")).toBeVisible();
			await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
				"content",
				"noindex",
			);
		});

		test(`${route} fits at 390px`, async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(route);
			const overflow = await page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}
});

test.describe("themes", () => {
	test("Paper and Night switch and persist on app routes", async ({ page }) => {
		await page.goto("/reader");
		const bg = () =>
			page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(await bg()).toBe("rgb(239, 241, 241)");
		await page.getByRole("button", { name: "Night theme" }).click();
		expect(await bg()).toBe("rgb(17, 19, 20)");
		await page.reload();
		expect(await bg()).toBe("rgb(17, 19, 20)");
		await page.getByRole("button", { name: "Paper theme" }).click();
		expect(await bg()).toBe("rgb(239, 241, 241)");
	});
});
