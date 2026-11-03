import { browser } from "$app/env";
import {
	applyTheme,
	parseTheme,
	THEME_STORAGE_KEY,
	type Theme,
} from "./theme.ts";

// The reader's chosen theme, kept in localStorage (no cookie). Public pages ignore it and
// stay Paper; the root layout decides where it applies.
class ThemeState {
	current = $state<Theme>("paper");

	constructor() {
		if (browser) {
			try {
				this.current = parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
			} catch {
				// Storage can be blocked; Paper is the default.
			}
		}
	}

	set(theme: Theme) {
		this.current = theme;
		applyTheme(document.documentElement, theme);
		try {
			localStorage.setItem(THEME_STORAGE_KEY, theme);
		} catch {
			// The choice still applies for this page.
		}
	}
}

export const theme = new ThemeState();
