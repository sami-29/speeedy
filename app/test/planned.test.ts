import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES } from "../src/lib/seo/pages.ts";
import {
	handlePrerenderError,
	PLANNED_PUBLIC_ROUTES,
} from "../src/lib/seo/planned.ts";

describe("prerender errors for planned routes", () => {
	it("lets a 404 for a planned route through", () => {
		for (const path of PLANNED_PUBLIC_ROUTES) {
			expect(() =>
				handlePrerenderError({ status: 404, path, message: "x" }),
			).not.toThrow();
		}
	});

	it("stops the build on any other missing page or any other status", () => {
		expect(() =>
			handlePrerenderError({ status: 404, path: "/typo", message: "gone" }),
		).toThrow("gone");
		expect(() =>
			handlePrerenderError({
				status: 500,
				path: PLANNED_PUBLIC_ROUTES[0] ?? "/",
				message: "broken",
			}),
		).toThrow("broken");
	});

	it("drops a route from the list once its page is in the sitemap", () => {
		const built = PUBLIC_PAGES.map((page) => page.path);
		for (const path of PLANNED_PUBLIC_ROUTES) {
			expect(
				built,
				`${path} is built, remove it from planned.ts`,
			).not.toContain(path);
		}
	});
});
