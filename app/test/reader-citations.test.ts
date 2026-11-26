import { describe, expect, it } from "vitest";
import { removeCitations } from "../src/lib/reader/citations.ts";

describe("removing citations", () => {
	it("takes out numbered references in brackets", () => {
		expect(removeCitations("Water boils at 100 °C [1].")).toBe(
			"Water boils at 100 °C.",
		);
		expect(removeCitations("Seen twice [2, 3] and again [4–7] here.")).toBe(
			"Seen twice and again here.",
		);
		expect(removeCitations("Odd spacing [ 12 ] goes too.")).toBe(
			"Odd spacing goes too.",
		);
	});

	it("takes out author and year in parentheses", () => {
		expect(removeCitations("Sleep helps memory (Walker, 2017).")).toBe(
			"Sleep helps memory.",
		);
		expect(
			removeCitations(
				"Two teams agree (Smith et al., 2020; Jones & Lee, 2021b) on this.",
			),
		).toBe("Two teams agree on this.");
	});

	it("leaves brackets and parentheses that are not citations", () => {
		const text =
			"Press [Enter] to go on (or wait). The 1990s (a decade) and [sic] stay.";
		expect(removeCitations(text)).toBe(text);
	});

	it("keeps paragraph breaks", () => {
		expect(removeCitations("One [1].\n\nTwo (Ng, 2019).")).toBe("One.\n\nTwo.");
	});
});
