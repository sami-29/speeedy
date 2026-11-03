import { attachParserWorker, type MessageScope } from "./protocol";

/**
 * The parser worker entry. The app starts it with Vite's worker import,
 * `import ParserWorker from "@speeedy/parsers/worker?worker"`, and talks to it through
 * `createParserClient(new ParserWorker())`.
 *
 * Importing this module anywhere that is not a worker scope (a test, the main thread) does
 * nothing, so it can never take over a page's own message handling.
 */
const scope = globalThis as unknown as Partial<MessageScope>;

if (
	!("window" in globalThis) &&
	typeof scope.postMessage === "function" &&
	typeof scope.addEventListener === "function"
) {
	attachParserWorker(scope as MessageScope);
}
