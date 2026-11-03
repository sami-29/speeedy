import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type BrowserContext,
	test as base,
	chromium,
	type Worker,
} from "@playwright/test";
import { buildExtension } from "../scripts/build.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Where the fixture article is served. It is answered from disk, so no network is needed. */
export const ARTICLE_URL = "http://articles.test/story";
export const EVIL_ORIGIN = "http://evil.test";

export const ARTICLE_TITLE = "How the lighthouse keeper counted his staircase";

type Fixtures = {
	/** A key for the unpacked extension, when it should not be the development one. */
	extensionKey: string | undefined;
	context: BrowserContext;
	worker: Worker;
	extensionId: string;
};

/**
 * A Chromium with the unpacked extension loaded. Playwright cannot click a toolbar button, so
 * this build has site access to the fixture host and a hook that does what the click does.
 * The store build has neither; the manifest tests cover that.
 */
export const test = base.extend<Fixtures>({
	extensionKey: [undefined, { option: true }],
	context: async ({ extensionKey }, use, testInfo) => {
		const baseURL = testInfo.project.use.baseURL as string;
		const dir = mkdtempSync(join(tmpdir(), "speeedy-ext-e2e-"));
		const extension = join(dir, "extension");
		await buildExtension({
			outDir: extension,
			origin: baseURL,
			dev: true,
			devKey: extensionKey,
			targets: ["chrome"],
			e2e: { hostPermissions: ["http://articles.test/*"] },
		});
		const context = await chromium.launchPersistentContext(
			join(dir, "profile"),
			{
				channel: "chromium",
				headless: true,
				args: [
					`--disable-extensions-except=${join(extension, "chrome")}`,
					`--load-extension=${join(extension, "chrome")}`,
				],
			},
		);
		const article = readFileSync(
			join(here, "..", "test", "fixtures", "article.html"),
			"utf8",
		);
		await context.route("http://articles.test/**", (route) =>
			route.fulfill({ contentType: "text/html", body: article }),
		);
		await use(context);
		await context.close();
		rmSync(dir, { recursive: true, force: true });
	},
	worker: async ({ context }, use) => {
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent("serviceworker"));
		await use(worker);
	},
	extensionId: async ({ worker }, use) => {
		await use(new URL(worker.url()).host);
	},
});

export { expect } from "@playwright/test";
