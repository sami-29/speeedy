import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const app = join(import.meta.dirname, "..");
const pixel = async (path: string, x: number, y: number) => {
	const { data, info } = await sharp(readFileSync(join(app, path)))
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const i = (y * info.width + x) * 4;
	return [...data.subarray(i, i + 4)];
};

describe("icon set", () => {
	it("keeps the red bars bleeding off the edge on the any-purpose icon", async () => {
		expect(await pixel("static/icons/icon-512.png", 256, 4)).toEqual([
			209, 45, 22, 255,
		]);
	});

	it("keeps the maskable icon art inside the safe zone", async () => {
		const [r, g, b] = await pixel("static/icons/icon-maskable-512.png", 256, 4);
		expect([r, g, b]).toEqual([239, 241, 241]);
		const art = await pixel("static/icons/icon-maskable-512.png", 256, 100);
		expect(art.slice(0, 3)).toEqual([209, 45, 22]);
	});

	it("gives the Android foreground and monochrome layers a transparent background", async () => {
		expect((await pixel("brand/generated/android/adaptive-foreground-432.png", 2, 2))[3]).toBe(0);
		expect((await pixel("brand/generated/android/adaptive-monochrome-432.png", 2, 2))[3]).toBe(0);
	});

	it("fills the Android background layer", async () => {
		expect((await pixel("brand/generated/android/adaptive-background-432.png", 2, 2))[3]).toBe(255);
	});
});
