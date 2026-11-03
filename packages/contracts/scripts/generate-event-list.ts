// Writes the published event list from the registry: pnpm --filter @speeedy/contracts generate
import { writeFileSync } from "node:fs";
import { EVENTS } from "../src/events.ts";
import { renderEventListMarkdown } from "../src/publish.ts";

writeFileSync(
	new URL("../generated/events.md", import.meta.url),
	renderEventListMarkdown(EVENTS),
);
