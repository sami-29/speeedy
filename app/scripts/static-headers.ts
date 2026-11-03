// Reads `static/_headers` (Cloudflare Pages' format) and applies it to `vite preview` and
// `vite dev`, so local runs and the e2e suite get the same headers production does. The
// cross-origin isolation headers for the reader come from there and nowhere else.
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

export type HeaderRule = { pattern: string; headers: [string, string][] };

/** Parse `_headers`: a URL pattern line, then indented `Name: value` lines. */
export function parseHeaders(text: string): HeaderRule[] {
	const rules: HeaderRule[] = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		if (!/^\s/.test(line)) {
			rules.push({ pattern: line.trim(), headers: [] });
			continue;
		}
		const colon = line.indexOf(":");
		const rule = rules.at(-1);
		if (!rule || colon < 0) continue;
		rule.headers.push([
			line.slice(0, colon).trim(),
			line.slice(colon + 1).trim(),
		]);
	}
	return rules;
}

const escapeRegExp = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** Whether a path-only pattern matches; `*` is a splat. Host patterns never match a path. */
function matches(pattern: string, path: string): boolean {
	if (!pattern.startsWith("/")) return false;
	const source = pattern.split("*").map(escapeRegExp).join(".*");
	return new RegExp(`^${source}$`).test(path);
}

/** The headers every matching rule sets for a path, in file order. */
export function headersFor(
	rules: readonly HeaderRule[],
	path: string,
): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const rule of rules) {
		if (!matches(rule.pattern, path)) continue;
		for (const [name, value] of rule.headers) headers[name] = value;
	}
	return headers;
}

/** Serve `_headers` from the dev and preview servers. */
export function staticHeaders(file: string): Plugin {
	const apply = (
		url: string | undefined,
		setHeader: (name: string, value: string) => void,
	) => {
		const path = decodeURI((url ?? "/").split(/[?#]/)[0] ?? "/");
		const rules = parseHeaders(readFileSync(file, "utf8"));
		for (const [name, value] of Object.entries(headersFor(rules, path)))
			setHeader(name, value);
	};
	return {
		name: "speeedy-static-headers",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				apply(req.url, (name, value) => res.setHeader(name, value));
				next();
			});
		},
		configurePreviewServer(server) {
			server.middlewares.use((req, res, next) => {
				apply(req.url, (name, value) => res.setHeader(name, value));
				next();
			});
		},
	};
}
