/// <reference types="vite/client" />
import { createParserClient } from "../../src/protocol";
import ParserWorker from "../../src/worker?worker";

/**
 * The real thing the app will do: start the parser worker the way Vite bundles it and talk
 * to it through the client. The tests drive it from Playwright.
 */
const client = createParserClient(new ParserWorker());

declare global {
	interface Window {
		parseBase64(base64: string, fileName: string): Promise<unknown>;
		parserReady: boolean;
	}
}

window.parseBase64 = (base64, fileName) => {
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	return client.parse(bytes, fileName);
};
window.parserReady = true;
