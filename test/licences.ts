// Licence check helpers: nothing a workspace package ships may be GPL-family, and no GPL
// phonemizer may be installed at all. Kokoro's G2P is a lexicon port so eSpeak stays out.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

/** GPL phonemizers: eSpeak in any packaging, the `phonemizer` package, and kokoro-js. */
const isBanned = (name: string) =>
	/espeak/i.test(name) || name === "phonemizer" || name === "kokoro-js";

/** True when every choice in an SPDX expression is GPL, LGPL or AGPL. */
export function isCopyleft(licence: string): boolean {
	const choices = licence.replace(/[()]/g, " ").split(/\s+OR\s+/i);
	return choices.every((choice) => /\b(?:A|L)?GPL\b/i.test(choice));
}

type Manifest = {
	name?: string;
	license?: string | { type?: string };
	licenses?: { type?: string }[];
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

const readManifest = (dir: string): Manifest =>
	JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

function licenceOf(pkg: Manifest): string | undefined {
	if (typeof pkg.license === "string") return pkg.license;
	if (pkg.license?.type) return pkg.license.type;
	const types = pkg.licenses?.map((l) => l.type).filter(Boolean);
	return types?.length ? types.join(" OR ") : undefined;
}

/** Node's lookup: the nearest `node_modules/<name>` from the package's real location up. */
function resolvePackage(from: string, name: string): string | undefined {
	let dir = from;
	for (;;) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json")))
			return realpathSync(candidate);
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/**
 * Walk the production dependencies (not devDependencies) of each package directory and list
 * every copyleft or banned package, as "name: reason".
 */
export function licenceProblems(packageDirs: readonly string[]): string[] {
	const seen = new Set<string>();
	const problems = new Set<string>();
	const visit = (dir: string, root: boolean) => {
		const real = realpathSync(dir);
		if (seen.has(real)) return;
		seen.add(real);
		const pkg = readManifest(real);
		if (!root) {
			const name = pkg.name ?? real;
			const licence = licenceOf(pkg);
			if (isBanned(name)) problems.add(`${name}: banned (GPL phonemizer)`);
			else if (licence && isCopyleft(licence))
				problems.add(`${name}: ${licence}`);
		}
		for (const dep of Object.keys({
			...pkg.dependencies,
			...pkg.optionalDependencies,
		})) {
			const found = resolvePackage(real, dep);
			if (found) visit(found, false);
			else if (isBanned(dep)) problems.add(`${dep}: banned (GPL phonemizer)`);
		}
	};
	for (const dir of packageDirs) visit(dir, true);
	return [...problems];
}

/** Every banned package named anywhere in a pnpm lockfile, dev tools included. */
export function bannedInLockfile(lock: string): string[] {
	const names = new Set<string>();
	for (const match of lock.matchAll(
		/^\s+'?\/?((?:@[^/@\s']+\/)?[^/@\s']+)@[^:\s']*'?:/gm,
	)) {
		const name = match[1] as string;
		if (isBanned(name)) names.add(name);
	}
	return [...names];
}

/** The workspace's package directories, from pnpm-workspace.yaml. */
export function workspacePackageDirs(root: string): string[] {
	const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
	const block = yaml.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
	const patterns = [...block.matchAll(/^\s+-\s+['"]?([^'"\s]+)['"]?/gm)].map(
		(m) => m[1] as string,
	);
	const dirs: string[] = [];
	for (const pattern of patterns) {
		if (pattern.endsWith("/*")) {
			const base = join(root, pattern.slice(0, -2));
			if (!existsSync(base)) continue;
			for (const entry of readdirSync(base, { withFileTypes: true })) {
				const dir = join(base, entry.name);
				if (entry.isDirectory() && existsSync(join(dir, "package.json")))
					dirs.push(dir);
			}
		} else if (existsSync(join(root, pattern, "package.json"))) {
			dirs.push(join(root, pattern));
		}
	}
	return dirs;
}
