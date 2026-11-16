// A theme is a family (the look) plus an appearance (light, dark, or whatever the system
// says). The root element carries both as `data-theme` and `data-scheme`; app.css does the
// rest. src/app.html repeats readChoice and resolveScheme in plain JS for the first paint;
// test/theme.test.ts holds the two together.

export const THEME_FAMILIES = ["paper", "classic", "cozy"] as const;
export type ThemeFamily = (typeof THEME_FAMILIES)[number];

export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export type Scheme = "light" | "dark";

export const THEME_STORAGE_KEY = "speeedy.theme";
export const APPEARANCE_STORAGE_KEY = "speeedy.appearance";

export const DEFAULT_FAMILY: ThemeFamily = "paper";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

// The page ground of each theme, for the browser bar (`<meta name="theme-color">`).
export const THEME_COLORS: Record<ThemeFamily, Record<Scheme, string>> = {
	paper: { light: "#eff1f1", dark: "#111314" },
	classic: { light: "#f3f3f8", dark: "#1a2027" },
	cozy: { light: "#dce6de", dark: "#1c1714" },
};

const isFamily = (value: string | null): value is ThemeFamily =>
	(THEME_FAMILIES as readonly (string | null)[]).includes(value);

const isAppearance = (value: string | null): value is Appearance =>
	(APPEARANCES as readonly (string | null)[]).includes(value);

/** Reads the two saved values. The old "night" theme is Paper in dark. */
export function readChoice(
	theme: string | null,
	appearance: string | null,
): { family: ThemeFamily; appearance: Appearance } {
	const family = isFamily(theme) ? theme : DEFAULT_FAMILY;
	if (isAppearance(appearance)) return { family, appearance };
	return {
		family: theme === "night" ? "paper" : family,
		appearance: theme === "night" ? "dark" : "system",
	};
}

export const resolveScheme = (
	appearance: Appearance,
	systemDark: boolean,
): Scheme =>
	appearance === "system" ? (systemDark ? "dark" : "light") : appearance;

export function applyTheme(
	root: { dataset: Record<string, string | undefined> },
	family: ThemeFamily,
	scheme: Scheme,
): void {
	root.dataset.theme = family;
	root.dataset.scheme = scheme;
}
