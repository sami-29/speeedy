import { describe, expect, it } from "vitest";
import {
	countWords,
	estimateReadingMinutes,
	htmlToPlainText,
	stripCitations,
} from "./text-utils.js";

describe("countWords", () => {
	it("counts simple space-separated words", () => {
		expect(countWords("hello world foo")).toBe(3);
	});

	it("returns 0 for empty string", () => {
		expect(countWords("")).toBe(0);
	});

	it("returns 0 for whitespace-only string", () => {
		expect(countWords("   \t\n  ")).toBe(0);
	});

	it("handles single word", () => {
		expect(countWords("hello")).toBe(1);
	});

	it("handles multiple spaces between words", () => {
		expect(countWords("hello   world")).toBe(2);
	});

	it("handles newlines between words", () => {
		expect(countWords("hello\nworld\nfoo")).toBe(3);
	});

	it("handles tabs between words", () => {
		expect(countWords("hello\tworld")).toBe(2);
	});

	it("handles mixed whitespace", () => {
		expect(countWords("  hello   world  ")).toBe(2);
	});

	it("counts words with punctuation attached", () => {
		// "hello," and "world." are each one word-like segment
		const count = countWords("hello, world.");
		expect(count).toBeGreaterThanOrEqual(2);
	});

	it("handles a longer paragraph", () => {
		const text =
			"The quick brown fox jumps over the lazy dog. It was a bright cold day.";
		expect(countWords(text)).toBeGreaterThanOrEqual(14);
	});
});

describe("estimateReadingMinutes", () => {
	it("returns '0' for zero word count", () => {
		expect(estimateReadingMinutes(0, 300)).toBe("0");
	});

	it("returns '0' for zero wpm", () => {
		expect(estimateReadingMinutes(300, 0)).toBe("0");
	});

	it("returns '<1 min' for very short texts", () => {
		// 10 words at 300 wpm = 2 seconds * 1.3 = ~2.6 seconds < 1 min
		expect(estimateReadingMinutes(10, 300)).toBe("<1 min");
	});

	it("returns correct minutes for a standard text", () => {
		// 300 words at 300 wpm = 1 min * 1.3 = 1.3 min → ceil = 2 min
		expect(estimateReadingMinutes(300, 300)).toBe("2 min");
	});

	it("returns correct minutes for a longer text", () => {
		// 3000 words at 300 wpm = 10 min * 1.3 = 13 min
		expect(estimateReadingMinutes(3000, 300)).toBe("13 min");
	});

	it("handles high wpm correctly", () => {
		// 600 words at 600 wpm = 1 min * 1.3 = 1.3 min → ceil = 2 min
		expect(estimateReadingMinutes(600, 600)).toBe("2 min");
	});

	it("returns negative inputs as '0'", () => {
		expect(estimateReadingMinutes(-100, 300)).toBe("0");
		expect(estimateReadingMinutes(100, -300)).toBe("0");
	});
});

describe("htmlToPlainText", () => {
	it("returns empty string for empty input", () => {
		expect(htmlToPlainText("")).toBe("");
	});

	it("extracts plain text from simple paragraph", () => {
		const result = htmlToPlainText("<p>Hello world</p>");
		expect(result).toContain("Hello world");
	});

	it("separates block elements with double newlines", () => {
		const result = htmlToPlainText("<p>First</p><p>Second</p>");
		expect(result).toContain("First");
		expect(result).toContain("Second");
		// Should have some separation between paragraphs
		expect(result.indexOf("First")).toBeLessThan(result.indexOf("Second"));
	});

	it("converts BR tags to newlines", () => {
		const result = htmlToPlainText("Line one<br>Line two");
		expect(result).toContain("Line one");
		expect(result).toContain("Line two");
	});

	it("handles nested elements", () => {
		const result = htmlToPlainText(
			"<div><p>Hello <strong>world</strong></p></div>",
		);
		expect(result).toContain("Hello");
		expect(result).toContain("world");
	});

	it("handles headings as block elements", () => {
		const result = htmlToPlainText("<h1>Title</h1><p>Body text</p>");
		expect(result).toContain("Title");
		expect(result).toContain("Body text");
	});

	it("strips HTML tags and returns only text", () => {
		const result = htmlToPlainText('<p class="test" id="foo">Just text</p>');
		expect(result).toBe("Just text");
	});

	it("handles list items as block elements", () => {
		const result = htmlToPlainText("<ul><li>Item 1</li><li>Item 2</li></ul>");
		expect(result).toContain("Item 1");
		expect(result).toContain("Item 2");
	});

	it("handles plain text without tags", () => {
		const result = htmlToPlainText("Just plain text");
		expect(result).toBe("Just plain text");
	});

	it("trims leading and trailing whitespace", () => {
		const result = htmlToPlainText("<p>  Hello  </p>");
		expect(result.startsWith(" ")).toBe(false);
		expect(result.endsWith(" ")).toBe(false);
	});
});

describe("stripCitations", () => {
	it("removes single numeric bracket citation", () => {
		expect(stripCitations("This is proven [1] in studies.")).toBe(
			"This is proven in studies.",
		);
	});

	it("removes multi-number bracket citation", () => {
		expect(stripCitations("Results [1, 2, 3] show improvement.")).toBe(
			"Results show improvement.",
		);
	});

	it("removes range bracket citation", () => {
		expect(stripCitations("As shown [1-5] previously.")).toBe(
			"As shown previously.",
		);
	});

	it("removes mixed range and list bracket citation", () => {
		expect(stripCitations("Evidence [1, 3-7, 9] supports this.")).toBe(
			"Evidence supports this.",
		);
	});

	it("removes author-year citation", () => {
		expect(stripCitations("As noted (Smith, 2020) the effect is clear.")).toBe(
			"As noted the effect is clear.",
		);
	});

	it("removes author et al. citation", () => {
		expect(stripCitations("Research (Smith et al., 2020) confirms this.")).toBe(
			"Research confirms this.",
		);
	});

	it("removes multi-author-year citation with semicolons", () => {
		expect(stripCitations("Studies (Smith, 2020; Jones, 2021) agree.")).toBe(
			"Studies agree.",
		);
	});

	it("removes author with ampersand citation", () => {
		expect(stripCitations("As shown (Smith & Jones, 2019) this works.")).toBe(
			"As shown this works.",
		);
	});

	it("handles multiple citations in one sentence", () => {
		expect(
			stripCitations(
				"Findings [1] support the theory (Smith, 2020) completely.",
			),
		).toBe("Findings support the theory completely.");
	});

	it("does not remove normal parenthetical text", () => {
		expect(stripCitations("The sample (n = 50) was large.")).toBe(
			"The sample (n = 50) was large.",
		);
	});

	it("does not remove short parenthetical phrases", () => {
		expect(stripCitations("Results (see above) are good.")).toBe(
			"Results (see above) are good.",
		);
	});

	it("returns empty string for empty input", () => {
		expect(stripCitations("")).toBe("");
	});

	it("handles text with no citations", () => {
		const text = "This is a normal sentence without any citations.";
		expect(stripCitations(text)).toBe(text);
	});
});
