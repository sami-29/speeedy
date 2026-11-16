import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	APPEARANCE_STORAGE_KEY,
	applyTheme,
	DEFAULT_FAMILY,
	readChoice,
	resolveScheme,
	THEME_COLORS,
	THEME_STORAGE_KEY,
} from "../src/lib/theme.ts";

describe("readChoice", () => {
	it("follows the system with the default family when nothing is saved", () => {
		expect(readChoice(null, null)).toEqual({
			family: DEFAULT_FAMILY,
			appearance: "system",
		});
	});

	it("reads each saved family and appearance", () => {
		expect(readChoice("classic", "light")).toEqual({
			family: "classic",
			appearance: "light",
		});
		expect(readChoice("cozy", "dark")).toEqual({
			family: "cozy",
			appearance: "dark",
		});
		expect(readChoice("paper", "system")).toEqual({
			family: "paper",
			appearance: "system",
		});
	});

	it("reads the old Night choice as Paper in dark", () => {
		expect(readChoice("night", null)).toEqual({
			family: "paper",
			appearance: "dark",
		});
		// A later appearance choice wins over the old Night value.
		expect(readChoice("night", "light")).toEqual({
			family: "paper",
			appearance: "light",
		});
	});

	it("ignores values it does not know", () => {
		expect(readChoice("sepia", "dim")).toEqual({
			family: DEFAULT_FAMILY,
			appearance: "system",
		});
	});
});

describe("resolveScheme", () => {
	it("follows the system only when the appearance is system", () => {
		expect(resolveScheme("system", true)).toBe("dark");
		expect(resolveScheme("system", false)).toBe("light");
		expect(resolveScheme("light", true)).toBe("light");
		expect(resolveScheme("dark", false)).toBe("dark");
	});
});

describe("applyTheme", () => {
	it("sets the family and the scheme on the root element", () => {
		const root = { dataset: {} as Record<string, string | undefined> };
		applyTheme(root, "cozy", "dark");
		expect(root.dataset).toEqual({ theme: "cozy", scheme: "dark" });
		applyTheme(root, "paper", "light");
		expect(root.dataset).toEqual({ theme: "paper", scheme: "light" });
	});

	it("has a browser bar colour for every family and scheme", () => {
		for (const family of ["paper", "classic", "cozy"] as const) {
			for (const scheme of ["light", "dark"] as const) {
				expect(THEME_COLORS[family][scheme]).toMatch(/^#[0-9a-f]{6}$/);
			}
		}
		expect(THEME_COLORS.paper.light).toBe("#eff1f1");
	});

	it("stores the choice locally under two keys", () => {
		expect(THEME_STORAGE_KEY).toBe("speeedy.theme");
		expect(APPEARANCE_STORAGE_KEY).toBe("speeedy.appearance");
	});
});

// The pre-paint script in app.html repeats readChoice and resolveScheme in plain JS so the
// first paint is right. Run it against fakes and hold it to the TypeScript.
describe("the pre-paint script in app.html", () => {
	const html = readFileSync(
		new URL("../src/app.html", import.meta.url),
		"utf8",
	);
	const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

	function run(
		pathname: string,
		saved: Record<string, string>,
		systemDark: boolean,
	) {
		const dataset: Record<string, string> = {};
		runInNewContext(script, {
			localStorage: { getItem: (key: string) => saved[key] ?? null },
			location: { pathname },
			matchMedia: (query: string) => ({
				matches: query === "(prefers-color-scheme: dark)" && systemDark,
			}),
			document: { documentElement: { dataset } },
		});
		return { ...dataset };
	}

	it("is in the page", () => {
		expect(script).toContain("speeedy.theme");
	});

	const cases: [string | undefined, string | undefined, boolean][] = [
		[undefined, undefined, false],
		[undefined, undefined, true],
		["night", undefined, false],
		["night", "light", true],
		["classic", undefined, true],
		["classic", "dark", false],
		["cozy", "light", true],
		["cozy", "system", true],
		["sepia", "dim", true],
	];

	for (const [theme, appearance, systemDark] of cases) {
		it(`matches the app for ${theme}/${appearance} with a ${systemDark ? "dark" : "light"} system`, () => {
			const saved: Record<string, string> = {};
			if (theme) saved["speeedy.theme"] = theme;
			if (appearance) saved["speeedy.appearance"] = appearance;
			const choice = readChoice(theme ?? null, appearance ?? null);
			const expected = {
				theme: choice.family,
				scheme: resolveScheme(choice.appearance, systemDark),
			};
			expect(run("/reader", saved, systemDark)).toEqual(expected);
			expect(run("/de/library/abc", saved, systemDark)).toEqual(expected);
		});
	}

	it("leaves public pages on Paper in light", () => {
		const saved = { "speeedy.theme": "cozy", "speeedy.appearance": "dark" };
		expect(run("/", saved, true)).toEqual({});
		expect(run("/learn/what-is-rsvp", saved, true)).toEqual({});
		expect(run("/readers", saved, true)).toEqual({});
	});

	it("survives blocked storage", () => {
		const dataset: Record<string, string> = {};
		expect(() =>
			runInNewContext(script, {
				localStorage: {
					getItem: () => {
						throw new Error("blocked");
					},
				},
				location: { pathname: "/reader" },
				matchMedia: () => ({ matches: false }),
				document: { documentElement: { dataset } },
			}),
		).not.toThrow();
	});
});
