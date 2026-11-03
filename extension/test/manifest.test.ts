import { createHash } from "node:crypto";
import { DEV_EXTENSION_ID, DEV_EXTENSION_KEY } from "@speeedy/contracts";
import { describe, expect, it } from "vitest";
import { buildManifest, STORE_REF, TARGETS } from "../src/manifest.ts";

const options = { version: "1.2.3", dev: false };

describe.each(TARGETS)("the %s manifest", (target) => {
	const manifest = buildManifest(target, options) as Record<string, any>;

	it("is Manifest V3 and carries the build's version", () => {
		expect(manifest.manifest_version).toBe(3);
		expect(manifest.version).toBe("1.2.3");
	});

	it("asks for exactly activeTab, scripting and contextMenus", () => {
		expect([...manifest.permissions].sort()).toEqual([
			"activeTab",
			"contextMenus",
			"scripting",
		]);
	});

	it("asks for nothing else: no site access, no always-on scripts, no outside callers", () => {
		for (const key of [
			"host_permissions",
			"optional_permissions",
			"optional_host_permissions",
			"content_scripts",
			"externally_connectable",
			"web_accessible_resources",
			"update_url",
			"commands",
		]) {
			expect(manifest, key).not.toHaveProperty(key);
		}
	});

	it("forbids the extension's own pages from any network connection", () => {
		const csp: string = manifest.content_security_policy.extension_pages;
		expect(csp).toContain("connect-src 'none'");
		expect(csp).toContain("script-src 'self'");
		expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|https?:/);
	});

	it("has a toolbar button without a popup, and an options page", () => {
		expect(manifest.action.default_popup).toBeUndefined();
		expect(manifest.action.default_title).toBeTruthy();
		expect(manifest.options_ui.page).toBe("options.html");
		expect(Object.keys(manifest.icons).sort()).toEqual([
			"128",
			"16",
			"32",
			"48",
		]);
	});

	it("leaves the extension ID to the store in a release build", () => {
		expect(manifest).not.toHaveProperty("key");
	});

	it("pins the development ID in a dev build", () => {
		const dev = buildManifest(target, { ...options, dev: true }) as Record<
			string,
			any
		>;
		if (target === "firefox") {
			expect(dev).not.toHaveProperty("key");
			return;
		}
		expect(dev.key).toBe(DEV_EXTENSION_KEY);
		const digest = createHash("sha256")
			.update(Buffer.from(dev.key, "base64"))
			.digest("hex")
			.slice(0, 32);
		const id = [...digest]
			.map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
			.join("");
		expect(id).toBe(DEV_EXTENSION_ID);
	});
});

describe("Chrome and Edge", () => {
	it.each(["chrome", "edge"] as const)("%s runs a service worker", (target) => {
		const manifest = buildManifest(target, options) as Record<string, any>;
		expect(manifest.background).toEqual({ service_worker: "background.js" });
		expect(manifest).not.toHaveProperty("browser_specific_settings");
	});
});

describe("Firefox", () => {
	const manifest = buildManifest("firefox", options) as Record<string, any>;

	it("runs an event page, since Firefox has no extension service workers", () => {
		expect(manifest.background).toEqual({ scripts: ["background.js"] });
	});

	it("declares that it collects no data", () => {
		expect(
			manifest.browser_specific_settings.gecko.data_collection_permissions,
		).toEqual({
			required: ["none"],
		});
	});

	it("has an add-on ID and a minimum version that knows data_collection_permissions", () => {
		const gecko = manifest.browser_specific_settings.gecko;
		expect(gecko.id).toMatch(/^[^@\s]+@[^@\s]+$/);
		expect(
			Number.parseInt(gecko.strict_min_version, 10),
		).toBeGreaterThanOrEqual(140);
	});
});

describe("store refs", () => {
	it("names the three stores the way the ref list does", () => {
		expect(STORE_REF).toEqual({
			chrome: "chrome-store",
			edge: "edge-store",
			firefox: "amo",
		});
	});
});
