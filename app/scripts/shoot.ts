// Measures page scroll on a running preview, per screen size and Reading Mode.
//
//   pnpm build && pnpm preview --port 4173      in another shell
//   node scripts/shoot.ts                       /reader at 320x640, 390x844, 1440x900 in RSVP, Pacer, Listen
//   node scripts/shoot.ts --sizes 390x844 --modes pacer --png .scratch/shots
//   node scripts/shoot.ts --route /library      a page without Reading Modes: one row per size
//
// Prints one row per run: scrollHeight vs clientHeight and scrollWidth vs clientWidth of the
// page. Exits 1 when any row scrolls, so it can gate a loop, and 2 on a bad argument.
// PNGs are written only with --png.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, chromium, type Page } from "@playwright/test";

const MODES = { rsvp: "RSVP", pacer: "Pacer", listen: "Listen" } as const;
type Mode = keyof typeof MODES;

const TEXT = `one two three four five six seven eight nine ten ${"more words to read ".repeat(80)}`;

function fail(message: string): never {
	console.error(`shoot: ${message}`);
	process.exit(2);
}

const { values } = parseArgs({
	options: {
		url: { type: "string", default: "http://localhost:4173" },
		route: { type: "string", default: "/reader" },
		sizes: { type: "string", default: "320x640,390x844,1440x900" },
		modes: { type: "string", default: "rsvp,pacer,listen" },
		png: { type: "string" },
	},
});

const sizes = values.sizes.split(",").map((size) => {
	const [width, height] = size.split("x").map(Number);
	if (!width || !height) fail(`size "${size}" is not WIDTHxHEIGHT`);
	return { width, height };
});

const isReader = values.route.startsWith("/reader");
const modes: (Mode | null)[] = isReader
	? values.modes.split(",").map((mode) => {
			if (!(mode in MODES))
				fail(`mode "${mode}" is not one of ${Object.keys(MODES).join(", ")}`);
			return mode as Mode;
		})
	: [null];

if (values.png) mkdirSync(values.png, { recursive: true });

// Paste the text, Start, Pause, then switch mode: the reader out of the focus state.
async function openReader(page: Page, mode: Mode) {
	await page.getByRole("textbox", { name: "Text to read" }).fill(TEXT);
	await page.getByRole("button", { name: "Start" }).click();
	await page.getByTestId("word").filter({ hasText: /\S/ }).waitFor();
	await page.getByRole("button", { name: "Pause" }).click();
	if (mode !== "rsvp") {
		await page
			.getByRole("group", { name: "Reading Mode" })
			.getByRole("button", { name: MODES[mode] })
			.click();
	}
}

async function measure(
	browser: Browser,
	size: { width: number; height: number },
	mode: Mode | null,
) {
	const page = await browser.newPage({ viewport: size });
	try {
		await page.goto(new URL(values.route, values.url).href);
		if (mode) await openReader(page, mode);
		await page.evaluate(() => document.fonts.ready);
		const box = await page.evaluate(() => {
			const root = document.documentElement;
			return {
				scrollHeight: root.scrollHeight,
				clientHeight: root.clientHeight,
				scrollWidth: root.scrollWidth,
				clientWidth: root.clientWidth,
			};
		});
		const name = `${size.width}x${size.height}${mode ? `-${mode}` : ""}`;
		if (values.png)
			await page.screenshot({ path: join(values.png, `${name}.png`) });
		return { name, ...box };
	} finally {
		await page.close();
	}
}

const browser = await chromium.launch();
let scrolls = false;
try {
	console.log(
		"run              down  scrollH/clientH  across  scrollW/clientW",
	);
	for (const size of sizes) {
		for (const mode of modes) {
			const row = await measure(browser, size, mode);
			const down = row.scrollHeight - row.clientHeight;
			const across = row.scrollWidth - row.clientWidth;
			if (down > 0 || across > 0) scrolls = true;
			console.log(
				`${row.name.padEnd(16)} ${String(down).padStart(5)}  ${`${row.scrollHeight}/${row.clientHeight}`.padStart(15)}  ${String(across).padStart(6)}  ${`${row.scrollWidth}/${row.clientWidth}`.padStart(15)}`,
			);
		}
	}
} finally {
	await browser.close();
}
if (values.png) console.log(`PNGs in ${values.png}`);
process.exitCode = scrolls ? 1 : 0;
