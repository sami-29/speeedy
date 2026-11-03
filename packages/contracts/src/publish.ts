import { renderExceptionMarkdown } from "./errors.ts";
import type { EventDef, EventRegistry, PropSpec } from "./events.ts";

export interface PropRow {
	name: string;
	type: "enum" | "int" | "bool" | "text";
	optional: boolean;
	values?: readonly string[];
	min?: number;
	max?: number;
}

export interface EventRow {
	name: string;
	origin: EventDef["origin"];
	kind: EventDef["kind"];
	schemaVersion: number;
	description: string;
	props: PropRow[];
}

function propRow(name: string, spec: PropSpec): PropRow {
	const row = { name, type: spec.kind, optional: !!spec.optional };
	switch (spec.kind) {
		case "enum":
			return { ...row, values: spec.values };
		case "int":
			return { ...row, min: spec.min, max: spec.max };
		case "text":
			return { ...row, max: spec.max };
		case "bool":
			return row;
	}
}

/** The registry as plain rows: what the published event list renders. */
export function eventList(registry: EventRegistry): EventRow[] {
	return Object.entries(registry).map(([name, def]) => ({
		name,
		origin: def.origin,
		kind: def.kind,
		schemaVersion: def.schemaVersion,
		description: def.description,
		props: Object.entries(def.props).map(([prop, spec]) => propRow(prop, spec)),
	}));
}

function describe(prop: PropRow): string {
	switch (prop.type) {
		case "enum":
			return `one of ${(prop.values ?? []).map((v) => `\`${v}\``).join(", ")}`;
		case "int":
			return `whole number from ${prop.min} to ${prop.max}`;
		case "bool":
			return "yes or no";
		case "text":
			return `free text, up to ${prop.max} characters (the survey form only)`;
	}
}

/** The published event list as Markdown. `generated/events.md` is this output. */
export function renderEventListMarkdown(registry: EventRegistry): string {
	const lines = [
		"<!-- Generated from packages/contracts/src/events.ts by `pnpm --filter @speeedy/contracts generate`. Do not edit by hand. -->",
		"",
		"# Speeedy analytics events",
		"",
		"Every event Speeedy can send. Each carries a random Visit ID that is held in memory only and changes on reload, and never a person profile, an IP address or any document text. Properties are fixed choices, bounded numbers or yes/no values. The one exception is the free text a reader types into the survey form.",
		"",
	];
	for (const event of eventList(registry)) {
		lines.push(
			`## \`${event.name}\``,
			"",
			event.description,
			"",
			`Sent by: ${event.origin === "client" ? "the app" : "the server"}. Schema version ${event.schemaVersion}.`,
			"",
		);
		if (event.props.length === 0) {
			lines.push("No properties.", "");
			continue;
		}
		lines.push("| Property | Value | Required |", "| --- | --- | --- |");
		for (const prop of event.props) {
			lines.push(
				`| \`${prop.name}\` | ${describe(prop)} | ${prop.optional ? "no" : "yes"} |`,
			);
		}
		lines.push("");
	}
	lines.push(renderExceptionMarkdown());
	return lines.join("\n");
}
