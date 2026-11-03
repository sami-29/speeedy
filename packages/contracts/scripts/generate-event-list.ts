// Writes the published event list from the registry: pnpm --filter @speeedy/contracts generate
import { writeFileSync } from "node:fs";
import { EVENTS, renderEventListMarkdown } from "../src/index.ts";

writeFileSync(
	new URL("../generated/events.md", import.meta.url),
	renderEventListMarkdown(EVENTS),
);
