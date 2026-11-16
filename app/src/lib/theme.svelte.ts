import { browser } from "$app/env";
import {
	APPEARANCE_STORAGE_KEY,
	type Appearance,
	DARK_QUERY,
	DEFAULT_FAMILY,
	readChoice,
	resolveScheme,
	THEME_STORAGE_KEY,
	type ThemeFamily,
} from "./theme.ts";

// The reader's theme and appearance, kept in localStorage (no cookie), and the system's
// light or dark setting, followed live. Public pages ignore all of it and stay Paper in
// light; the root layout decides where it applies.
class ThemeState {
	family = $state<ThemeFamily>(DEFAULT_FAMILY);
	appearance = $state<Appearance>("system");
	systemDark = $state(false);
	scheme = $derived(resolveScheme(this.appearance, this.systemDark));

	constructor() {
		if (!browser) return;
		try {
			const choice = readChoice(
				localStorage.getItem(THEME_STORAGE_KEY),
				localStorage.getItem(APPEARANCE_STORAGE_KEY),
			);
			this.family = choice.family;
			this.appearance = choice.appearance;
		} catch {
			// Storage can be blocked; the defaults stand.
		}
		const query = matchMedia(DARK_QUERY);
		this.systemDark = query.matches;
		query.addEventListener("change", (event) => {
			this.systemDark = event.matches;
		});
	}

	setFamily(family: ThemeFamily) {
		this.family = family;
		this.save();
	}

	setAppearance(appearance: Appearance) {
		this.appearance = appearance;
		this.save();
	}

	// Both keys are written together, so an old "night" value never outlives a new choice.
	private save() {
		try {
			localStorage.setItem(THEME_STORAGE_KEY, this.family);
			localStorage.setItem(APPEARANCE_STORAGE_KEY, this.appearance);
		} catch {
			// The choice still applies for this page.
		}
	}
}

export const theme = new ThemeState();
