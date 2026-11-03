import { describe, expect, it } from "vitest";
import { applyTheme, parseTheme, THEME_STORAGE_KEY } from "../src/lib/theme.ts";

describe("theme", () => {
	it("defaults to paper for anything that is not a known theme", () => {
		expect(parseTheme(null)).toBe("paper");
		expect(parseTheme("sepia")).toBe("paper");
		expect(parseTheme("night")).toBe("night");
		expect(parseTheme("paper")).toBe("paper");
	});

	it("sets data-theme on the root element", () => {
		const root = { dataset: {} as Record<string, string> };
		applyTheme(root, "night");
		expect(root.dataset.theme).toBe("night");
		applyTheme(root, "paper");
		expect(root.dataset.theme).toBe("paper");
	});

	it("stores the choice locally under one key", () => {
		expect(THEME_STORAGE_KEY).toBe("speeedy.theme");
	});
});
