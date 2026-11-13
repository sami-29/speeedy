import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_COLORS } from "../src/lib/theme.ts";

// Every theme, light and dark, has to pass WCAG AA. This reads the colour tokens straight
// from app.css, applies the theme blocks the way the cascade would, and checks the pairs
// the app actually draws.

const css = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");

type Tokens = Record<string, string>;

function declarations(body: string): Tokens {
	const tokens: Tokens = {};
	for (const match of body.matchAll(
		/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi,
	)) {
		tokens[match[1]] = match[2].toLowerCase();
	}
	return tokens;
}

const base = declarations(
	/@theme static \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "",
);

// `:root[data-x="y"]...` blocks, in source order, with the attributes each one needs.
const blocks = [
	...css.matchAll(/^:root((?:\[data-[a-z]+="[a-z]+"\])+)\s*\{([\s\S]*?)\n\}/gm),
].map((match) => ({
	needs: Object.fromEntries(
		[...match[1].matchAll(/\[data-([a-z]+)="([a-z]+)"\]/g)].map((m) => [
			m[1],
			m[2],
		]),
	),
	tokens: declarations(match[2]),
}));

function tokensFor(theme: string, scheme: string): Tokens {
	const attrs: Record<string, string> = { theme, scheme };
	const matching = blocks
		.filter((block) =>
			Object.entries(block.needs).every(([k, v]) => attrs[k] === v),
		)
		// More attributes win, as in the cascade; source order breaks ties.
		.sort((a, b) => Object.keys(a.needs).length - Object.keys(b.needs).length);
	return Object.assign({}, base, ...matching.map((block) => block.tokens));
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum]
const pairs: [string, string, number][] = [
	["ink", "paper", 4.5],
	["ink-2", "paper", 4.5],
	["ink-3", "paper", 4.5],
	["ink", "paper-2", 4.5],
	["ink-2", "paper-2", 4.5],
	["ink-3", "paper-2", 4.5],
	["red-ink", "paper", 4.5],
	["on-red", "red", 4.5],
	["on-accent", "accent", 4.5],
	["on-accent", "accent-hover", 4.5],
	// Non-text marks: the reading position, focus rings, the primary action's edge.
	["red", "paper", 3],
	["accent", "paper", 3],
];

describe("theme contrast", () => {
	for (const theme of ["paper", "classic", "cozy"]) {
		for (const scheme of ["light", "dark"]) {
			it(`${theme} ${scheme} passes WCAG AA`, () => {
				const tokens = tokensFor(theme, scheme);
				const failures = pairs
					.map(([fg, bg, min]) => {
						expect(tokens[fg], `--color-${fg}`).toBeDefined();
						expect(tokens[bg], `--color-${bg}`).toBeDefined();
						const ratio = contrast(tokens[fg], tokens[bg]);
						return ratio < min
							? `${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`
							: null;
					})
					.filter(Boolean);
				expect(failures).toEqual([]);
			});
		}
	}

	it("gives each theme its own colours", () => {
		const grounds = ["paper", "classic", "cozy"].flatMap((theme) =>
			["light", "dark"].map((scheme) => tokensFor(theme, scheme).paper),
		);
		expect(new Set(grounds).size).toBe(6);
	});

	it("gives the browser bar each theme's own ground", () => {
		for (const theme of ["paper", "classic", "cozy"] as const) {
			for (const scheme of ["light", "dark"] as const) {
				expect(THEME_COLORS[theme][scheme]).toBe(
					tokensFor(theme, scheme).paper,
				);
			}
		}
	});
});
