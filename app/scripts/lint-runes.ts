// Fails on Svelte 4 syntax. Every .svelte file under src is compiled in runes mode, so
// `export let`, `$:` and other legacy forms are compile errors, and every compiler warning
// (deprecated `on:` directives, `<slot>`, `<svelte:component>`, accessibility) is a failure.
// The compiler does not warn about a few legacy imports, so those are matched by hand.
//
//   node scripts/lint-runes.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";

const legacyImports: [RegExp, string][] = [
	[/\bcreateEventDispatcher\b/, "createEventDispatcher: use callback props"],
	[
		/\b(beforeUpdate|afterUpdate)\b/,
		"beforeUpdate/afterUpdate: use $effect.pre/$effect",
	],
	[/\$app\/stores/, "$app/stores: use $app/state"],
];

export function lintSvelte(source: string, filename: string): string[] {
	const problems: string[] = [];
	try {
		const { warnings } = compile(source, {
			filename,
			runes: true,
			generate: "client",
		});
		for (const w of warnings) {
			problems.push(`${w.code}: ${w.message}`);
		}
	} catch (error) {
		problems.push(error instanceof Error ? error.message : String(error));
	}
	for (const [pattern, message] of legacyImports) {
		if (pattern.test(source)) problems.push(message);
	}
	return problems;
}

const svelteFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(path);
		return entry.name.endsWith(".svelte") ? [path] : [];
	});

function main() {
	const app = join(dirname(fileURLToPath(import.meta.url)), "..");
	let failed = 0;
	const files = svelteFiles(join(app, "src"));
	for (const file of files) {
		const problems = lintSvelte(readFileSync(file, "utf8"), file);
		for (const problem of problems) {
			failed++;
			console.error(`${relative(app, file)}: ${problem}`);
		}
	}
	if (failed > 0) {
		console.error(
			`\n${failed} Svelte 4 or compiler problem(s) in ${files.length} file(s)`,
		);
		process.exit(1);
	}
	console.log(`runes lint: ${files.length} .svelte files clean`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
