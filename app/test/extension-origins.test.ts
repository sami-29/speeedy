import { DEV_EXTENSION_ID } from "@speeedy/contracts/launcher";
import { describe, expect, it } from "vitest";
import { trustedOriginsDefine } from "../scripts/extension-origins.ts";

describe("trustedOriginsDefine", () => {
	it("trusts no extension in a production build when nothing is configured", () => {
		expect(trustedOriginsDefine("build", {})).toBe("");
		expect(
			trustedOriginsDefine("build", { SPEEEDY_EXTENSION_ORIGINS: undefined }),
		).toBe("");
	});

	it("trusts the development extension, and Firefox on confirmation, under `vite dev`", () => {
		const list = trustedOriginsDefine("serve", {}).split(",");
		expect(list).toContain(`chrome-extension://${DEV_EXTENSION_ID}`);
		expect(list).toContain("moz-extension://*");
	});

	it("passes a configured list through in either mode", () => {
		const configured = "chrome-extension://abc,moz-extension://*";
		expect(
			trustedOriginsDefine("build", { SPEEEDY_EXTENSION_ORIGINS: configured }),
		).toBe(configured);
		expect(
			trustedOriginsDefine("serve", { SPEEEDY_EXTENSION_ORIGINS: configured }),
		).toBe(configured);
	});

	it("keeps an explicitly empty list empty, even under `vite dev`", () => {
		expect(
			trustedOriginsDefine("serve", { SPEEEDY_EXTENSION_ORIGINS: "" }),
		).toBe("");
	});
});
