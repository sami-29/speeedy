// Renders the mark's raster set from the tracked SVG masters in brand/masters.
//
//   node scripts/generate-icons.ts           write the files
//   node scripts/generate-icons.ts --check   fail if a committed file differs from a fresh render
//
// Every PNG is a pure function of a master, so the output is reproducible. The check compares
// decoded pixels, not file bytes, so a different PNG encoder build cannot cause a false alarm.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const master = (name: string) =>
	readFileSync(join(app, "brand/masters", `${name}.svg`));

const PAPER = { r: 239, g: 241, b: 241, alpha: 1 };
// Maskable icons are cropped to a circle of 40% of the width, so the art shrinks to 70% and
// sits on a paper field: the red bars end 77px from the edge, inside the safe zone.
const MASKABLE_SCALE = 0.7;

const viewBoxWidth = (svg: Buffer) => {
	const match = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) [\d.]+"/.exec(
		svg.toString("utf8"),
	);
	if (!match?.[1]) throw new Error("master has no viewBox");
	return Number(match[1]);
};

// Rasterise at the target size by raising the density, so edges are drawn sharp, not scaled.
const render = (svg: Buffer, size: number) =>
	sharp(svg, { density: (72 * size) / viewBoxWidth(svg) })
		.resize(size, size)
		.png()
		.toBuffer();

const maskable = async (svg: Buffer, size: number) => {
	const art = Math.round(size * MASKABLE_SCALE);
	const offset = Math.round((size - art) / 2);
	return sharp({
		create: { width: size, height: size, channels: 4, background: PAPER },
	})
		.composite([{ input: await render(svg, art), left: offset, top: offset }])
		.png()
		.toBuffer();
};

// An ICO file holding PNG images (supported since Windows Vista and by every browser).
const ico = (images: { size: number; png: Buffer }[]) => {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = 6 + 16 * images.length;
	const entries = images.map(({ size, png }) => {
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size, 0);
		entry.writeUInt8(size, 1);
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(png.length, 8);
		entry.writeUInt32LE(offset, 12);
		offset += png.length;
		return entry;
	});
	return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
};

// The share image, 1200x630 (wayfinder ticket 24): paper, with the red axis at 35% running
// the full height and breaking only where the wordmark's own ticks take over. The wordmark's
// red ticks sit on that axis; the line above and below is drawn to the same width.
const OG = { width: 1200, height: 630, axisX: 420, wordmarkScale: 0.2 };
const WORDMARK_VIEWBOX = { x: -10, y: -900, width: 4370, height: 1200 };
// The ticks inside the wordmark master (x and width, in its own units).
const WORDMARK_TICK = { x: 1589.401611328125, width: 62 };

async function ogImage(): Promise<Buffer> {
	const { width, height, axisX, wordmarkScale: s } = OG;
	const view = WORDMARK_VIEWBOX;
	const source = master("wordmark").toString("utf8");
	if (
		!source.includes(
			`viewBox="${view.x} ${view.y} ${view.width} ${view.height}"`,
		)
	) {
		throw new Error(
			"wordmark master changed: update WORDMARK_VIEWBOX and WORDMARK_TICK",
		);
	}
	const inner = source
		.replace(/^[\s\S]*?<svg[^>]*>/, "")
		.replace(/<\/svg>\s*$/, "");
	const tickCentre = (WORDMARK_TICK.x + WORDMARK_TICK.width / 2 - view.x) * s;
	const left = axisX - tickCentre;
	const markHeight = view.height * s;
	const top = (height - markHeight) / 2;
	const axisWidth = WORDMARK_TICK.width * s;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="geometricPrecision"><rect width="${width}" height="${height}" fill="#eff1f1"/><rect x="${axisX - axisWidth / 2}" y="0" width="${axisWidth}" height="${top}" fill="#d12d16"/><rect x="${axisX - axisWidth / 2}" y="${top + markHeight}" width="${axisWidth}" height="${height - top - markHeight}" fill="#d12d16"/><svg x="${left}" y="${top}" width="${view.width * s}" height="${markHeight}" viewBox="${view.x} ${view.y} ${view.width} ${view.height}">${inner}</svg></svg>`;
	return sharp(Buffer.from(svg), { density: 72 })
		.resize(width, height)
		.png()
		.toBuffer();
}

export async function buildIcons(): Promise<Map<string, Buffer>> {
	const out = new Map<string, Buffer>();
	const icon512 = master("icon-512");

	out.set("static/favicon.svg", master("icon-32"));
	out.set("static/brand/wordmark.svg", master("wordmark"));
	out.set("static/brand/wordmark-night.svg", master("wordmark-night"));
	const favicons = await Promise.all(
		[16, 32, 48].map(async (size) => ({
			size,
			png: await render(master(`icon-${size}`), size),
		})),
	);
	for (const { size, png } of favicons) {
		out.set(`static/icons/favicon-${size}.png`, png);
	}
	out.set("static/favicon.ico", ico(favicons));

	out.set("static/apple-touch-icon.png", await render(icon512, 180));
	out.set("static/icons/icon-192.png", await render(icon512, 192));
	out.set("static/icons/icon-512.png", await render(icon512, 512));
	out.set("static/icons/icon-maskable-512.png", await maskable(icon512, 512));

	// Extension toolbar sizes use the optically drawn small masters where they exist.
	for (const [size, name] of [
		[16, "icon-16"],
		[32, "icon-32"],
		[48, "icon-48"],
		[128, "icon-512"],
	] as const) {
		out.set(
			`brand/generated/extension/icon-${size}.png`,
			await render(master(name), size),
		);
	}

	out.set("static/og-image.png", await ogImage());

	// Android adaptive layers are 108dp; 432px is xxxhdpi.
	for (const layer of ["background", "foreground", "monochrome"]) {
		out.set(
			`brand/generated/android/adaptive-${layer}-432.png`,
			await render(master(`adaptive-${layer}`), 432),
		);
	}
	return out;
}

const pixels = async (file: Buffer) => {
	const { data, info } = await sharp(file)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
};

const icoPngs = (file: Buffer) => {
	const count = file.readUInt16LE(4);
	return Array.from({ length: count }, (_, i) => {
		const length = file.readUInt32LE(6 + 16 * i + 8);
		const offset = file.readUInt32LE(6 + 16 * i + 12);
		return file.subarray(offset, offset + length);
	});
};

const same = async (path: string, fresh: Buffer, disk: Buffer) => {
	if (path.endsWith(".svg")) return fresh.equals(disk);
	if (path.endsWith(".ico")) {
		const a = icoPngs(fresh);
		const b = icoPngs(disk);
		if (a.length !== b.length) return false;
		for (const [i, png] of a.entries()) {
			if (!(await same("x.png", png, b[i] as Buffer))) return false;
		}
		return true;
	}
	const a = await pixels(fresh);
	const b = await pixels(disk);
	return a.width === b.width && a.height === b.height && a.data.equals(b.data);
};

async function main() {
	const check = process.argv.includes("--check");
	const icons = await buildIcons();
	const stale: string[] = [];
	for (const [path, fresh] of icons) {
		const target = join(app, path);
		if (check) {
			if (
				!existsSync(target) ||
				!(await same(path, fresh, readFileSync(target)))
			) {
				stale.push(path);
			}
		} else {
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, fresh);
		}
	}
	if (check) {
		if (stale.length > 0) {
			console.error(
				`Icons are stale; run \`pnpm --filter @speeedy/app icons\`:\n  ${stale.join("\n  ")}`,
			);
			process.exit(1);
		}
		console.log(`${icons.size} icons match the masters`);
	} else {
		console.log(`wrote ${icons.size} icons`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
