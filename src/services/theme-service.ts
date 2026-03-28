import type { ThemeName } from "../models/types.js";

export interface ThemeConfig {
	name: ThemeName;
	label: string;
	/** DaisyUI `data-theme` value (for system, the resolved light/dark). */
	daisyTheme: string;
}

const MEDIA =
	typeof window !== "undefined"
		? window.matchMedia("(prefers-color-scheme: dark)")
		: null;
let systemListener: (() => void) | null = null;

function getResolvedDaisyTheme(): "light" | "dark" {
	if (!MEDIA) return "dark";
	return MEDIA.matches ? "dark" : "light";
}

export const THEMES: ThemeConfig[] = [
	{ name: "system", label: "💻  System", daisyTheme: "dark" },
	{ name: "dark", label: "🌙  Dark", daisyTheme: "dark" },
	{ name: "light", label: "☀️  Light", daisyTheme: "light" },
];

export function applyTheme(themeName: ThemeName): void {
	if (themeName === "system") {
		const resolved = getResolvedDaisyTheme();
		document.documentElement.setAttribute("data-theme", resolved);
		if (MEDIA && !systemListener) {
			systemListener = () => applyTheme("system");
			MEDIA.addEventListener("change", systemListener);
		}
		return;
	}
	if (systemListener && MEDIA) {
		MEDIA.removeEventListener("change", systemListener);
		systemListener = null;
	}
	const config = THEMES.find((t) => t.name === themeName) ?? THEMES[0];
	document.documentElement.setAttribute("data-theme", config.daisyTheme);
}

export function getThemeConfig(themeName: ThemeName): ThemeConfig {
	if (themeName === "system") {
		return {
			name: "system",
			label: "💻  System",
			daisyTheme: getResolvedDaisyTheme(),
		};
	}
	return THEMES.find((t) => t.name === themeName) ?? THEMES[0];
}

export function getResolvedTheme(themeName: ThemeName): "light" | "dark" {
	return themeName === "system" ? getResolvedDaisyTheme() : themeName;
}
