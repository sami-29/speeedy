// A direct plan check ("is this Plus?") outside the plans module fails this test. Code asks
// hasFeature(account, feature) or limit(account, name) instead.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PLAN = "(?:free|plus)";
const QUOTE = "[\"'`]";

/** Matches `plan === 'plus'`, `'plus' !== x.plan`, `case "plus":` and `isPlus(...)`. */
const DIRECT_PLAN_CHECK = new RegExp(
	[
		`[!=]==?\\s*${QUOTE}${PLAN}${QUOTE}`,
		`${QUOTE}${PLAN}${QUOTE}\\s*[!=]==?`,
		`case\\s+${QUOTE}${PLAN}${QUOTE}\\s*:`,
		"\\bis(?:Plus|Free)\\w*",
	].join("|"),
);

// Only the plans module, and the tests that name plans on purpose, may.
const ALLOWED = new Set([
	join("packages", "contracts", "src", "plans.ts"),
	join("packages", "contracts", "test", "plans.test.ts"),
	join("packages", "contracts", "test", "plans-client.test.ts"),
	join("packages", "contracts", "test", "plan-checks.test.ts"),
	join("worker", "test", "plan.test.ts"),
]);
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".git", ".wrangler"]);
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|svelte|html)$/;

function* sourceFiles(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (SKIPPED_DIRS.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* sourceFiles(path);
		else if (SOURCE.test(name)) yield path;
	}
}

describe("the direct plan check detector", () => {
	it("flags the checks it exists to catch", () => {
		for (const code of [
			"if (plan === 'plus') {",
			'if (account.plan !== "free")',
			"if ('plus' == plan)",
			'switch (x) { case "plus": break }',
			"if (isPlus(account))",
			"if (user.isPlusUser)",
		]) {
			assert.ok(DIRECT_PLAN_CHECK.test(code), code);
		}
	});

	it("leaves feature and limit checks alone", () => {
		for (const code of [
			'if (hasFeature(account, "sync")) {',
			'const cap = limit(account, "syncBytes");',
			'const label = "Plus";',
		]) {
			assert.equal(DIRECT_PLAN_CHECK.test(code), false, code);
		}
	});
});

describe("source outside the plans module", () => {
	it("never checks the plan directly", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(root)) {
			const rel = relative(root, file);
			if (ALLOWED.has(rel)) continue;
			readFileSync(file, "utf8")
				.split("\n")
				.forEach((line, index) => {
					if (DIRECT_PLAN_CHECK.test(line))
						offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
				});
		}
		assert.deepEqual(offenders, []);
	});
});
