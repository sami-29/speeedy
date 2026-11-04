import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@speeedy/parsers";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(
	readFileSync(join(root, "static/manifest.webmanifest"), "utf8"),
) as {
	[key: string]: unknown;
	icons: { src: string; sizes: string; type: string; purpose?: string }[];
	file_handlers: { action: string; accept: Record<string, string[]> }[];
};

describe("web app manifest", () => {
	it("installs as a standalone app that opens the reader", () => {
		expect(manifest.name).toBe("Speeedy");
		expect(manifest.short_name).toBe("Speeedy");
		expect(manifest.id).toBe("/");
		expect(manifest.scope).toBe("/");
		expect(manifest.start_url).toBe("/reader");
		expect(manifest.display).toBe("standalone");
	});

	it("uses the Paper colours, as the page's theme-color does", () => {
		const html = readFileSync(join(root, "src/app.html"), "utf8");
		const themeColor = /name="theme-color" content="(#[0-9a-f]{6})"/.exec(
			html,
		)?.[1];
		expect(manifest.theme_color).toBe(themeColor);
		expect(manifest.background_color).toBe(themeColor);
	});

	it("reuses the generated icons, including a maskable one", () => {
		const icons = manifest.icons as {
			src: string;
			sizes: string;
			type: string;
			purpose?: string;
		}[];
		for (const icon of icons) {
			expect(icon.type).toBe("image/png");
			expect(existsSync(join(root, "static", icon.src)), icon.src).toBe(true);
		}
		const find = (src: string) => icons.find((icon) => icon.src === src);
		expect(find("/icons/icon-192.png")?.sizes).toBe("192x192");
		expect(find("/icons/icon-512.png")?.sizes).toBe("512x512");
		expect(find("/icons/icon-512.png")?.purpose ?? "any").toBe("any");
		expect(find("/icons/icon-maskable-512.png")?.purpose).toBe("maskable");
	});

	it("takes shared text and pages at /reader with a GET query", () => {
		expect(manifest.share_target).toEqual({
			action: "/reader",
			method: "GET",
			enctype: "application/x-www-form-urlencoded",
			params: { title: "title", text: "text", url: "url" },
		});
	});

	it("opens files at /reader, for formats the parsers read", () => {
		const handlers = manifest.file_handlers as {
			action: string;
			accept: Record<string, string[]>;
		}[];
		expect(handlers).toHaveLength(1);
		expect(handlers[0]?.action).toBe("/reader");
		const extensions = Object.values(handlers[0]?.accept ?? {}).flat();
		expect(extensions.every((e) => /^\.[a-z0-9]+$/.test(e))).toBe(true);
		for (const wanted of [
			".txt",
			".md",
			".csv",
			".html",
			".docx",
			".epub",
			".odt",
			".pdf",
		])
			expect(extensions, wanted).toContain(wanted);
		// Formats the parsers cannot read yet are not offered.
		for (const unread of [".mobi", ".azw3", ".fb2", ".doc", ".rtf"])
			expect(extensions, unread).not.toContain(unread);
	});

	it("offers only text formats the parser really opens", async () => {
		const bytes = new TextEncoder().encode("A short line of text to read.\n");
		for (const name of ["a.txt", "a.md", "a.csv", "a.html"]) {
			const outcome = await parse(bytes, name);
			expect(outcome.ok, name).toBe(true);
		}
	});

	it("is linked from every page", () => {
		const html = readFileSync(join(root, "src/app.html"), "utf8");
		expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
	});
});
