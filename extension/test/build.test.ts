import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExtension } from "../scripts/build.ts";
import { STORE_REF, TARGETS } from "../src/manifest.ts";

const ORIGIN = "https://launcher-test.example";

let out: string;
beforeAll(async () => {
	out = mkdtempSync(join(tmpdir(), "speeedy-extension-"));
	await buildExtension({ outDir: out, origin: ORIGIN, dev: false });
}, 60_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

const read = (target: string, file: string) =>
	readFileSync(join(out, target, file), "utf8");

const scripts = (target: string) =>
	readdirSync(join(out, target)).filter((name) => name.endsWith(".js"));

describe.each(TARGETS)("the %s build", (target) => {
	it("writes the manifest, the scripts, the pages and the icons", () => {
		for (const file of [
			"manifest.json",
			"background.js",
			"extract.js",
			"relay.html",
			"relay.js",
			"options.html",
			"icons/icon-16.png",
			"icons/icon-32.png",
			"icons/icon-48.png",
			"icons/icon-128.png",
		]) {
			expect(existsSync(join(out, target, file)), file).toBe(true);
		}
	});

	it("ships the Readability licence, which asks for its text to travel with the code", () => {
		expect(read(target, "Readability-LICENSE.md")).toContain("Apache License");
		expect(read(target, "OFL.txt")).toContain("SIL OPEN FONT LICENSE");
	});

	it("has a manifest with the three permissions and nothing more", () => {
		const manifest = JSON.parse(read(target, "manifest.json"));
		expect([...manifest.permissions].sort()).toEqual([
			"activeTab",
			"contextMenus",
			"scripting",
		]);
		expect(manifest).not.toHaveProperty("host_permissions");
	});

	it("makes no network call of its own: no fetch, XHR, socket, beacon or remote import", () => {
		const banned =
			/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|\bimport\s*\(/;
		for (const name of scripts(target)) {
			expect(read(target, name), name).not.toMatch(banned);
		}
	});

	it("loads nothing from outside the package in its pages", () => {
		for (const page of ["relay.html", "options.html"]) {
			const html = read(target, page);
			expect(html).not.toMatch(/<script[^>]+src="(?!\w[\w.-]*\.js")/);
			expect(html).not.toMatch(/<link[^>]+href="https?:/);
			expect(html).not.toMatch(/<img[^>]+src="https?:/);
			expect(html).not.toMatch(/<script>|\son\w+=/);
		}
	});

	it("points the relay at the configured Speeedy site and nowhere else", () => {
		const relay = read(target, "relay.js");
		expect(relay).toContain(ORIGIN);
		expect(relay).not.toContain("speeedy.pages.dev");
	});

	it("links News and support and the privacy anchor, each carrying this store's ref", () => {
		const options = read(target, "options.html");
		const ref = STORE_REF[target];
		expect(options).toContain(`href="${ORIGIN}/support?ref=${ref}"`);
		expect(options).toContain("News and support");
		expect(options).toContain(`href="${ORIGIN}/privacy?ref=${ref}#extension"`);
	});
});

describe("the Firefox build", () => {
	it("says it collects no data", () => {
		const manifest = JSON.parse(read("firefox", "manifest.json"));
		expect(
			manifest.browser_specific_settings.gecko.data_collection_permissions,
		).toEqual({
			required: ["none"],
		});
	});
});

describe("a dev build", () => {
	it("carries the development key so Playwright and the app know the ID", async () => {
		const dev = mkdtempSync(join(tmpdir(), "speeedy-extension-dev-"));
		try {
			await buildExtension({
				outDir: dev,
				origin: ORIGIN,
				dev: true,
				targets: ["chrome"],
			});
			const manifest = JSON.parse(
				readFileSync(join(dev, "chrome", "manifest.json"), "utf8"),
			);
			expect(typeof manifest.key).toBe("string");
			expect(existsSync(join(dev, "firefox"))).toBe(false);
		} finally {
			rmSync(dev, { recursive: true, force: true });
		}
	}, 60_000);
});
