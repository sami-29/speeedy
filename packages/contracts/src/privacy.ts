import type { EventDef, PropSpec, Registry } from "./events.ts";

/** A marker that stands for document text. It must never get through any event. */
export const CANARY = "CANARY-document-text-7f3a9c";

export interface Example {
	event: string;
	origin: EventDef["origin"];
	properties: Record<string, string | number | boolean>;
}

export interface PrivacyCase extends Example {
	label: string;
}

/** Property names a careless change might add to carry page content or a URL. */
const LEAKY_NAMES = ["document_text", "title", "url", "hash"];

function maximalValue(spec: PropSpec): string | number | boolean {
	switch (spec.kind) {
		case "enum":
			return spec.values[0];
		case "int":
			return spec.max;
		case "bool":
			return true;
		case "text":
			return "ok";
	}
}

/** For each event, a valid payload that sets every property. */
export function validExamples(registry: Registry): Example[] {
	return Object.entries(registry).map(([event, def]) => ({
		event,
		origin: def.origin,
		properties: Object.fromEntries(
			Object.entries(def.props).map(([name, spec]) => [
				name,
				maximalValue(spec),
			]),
		),
	}));
}

/**
 * Payloads the registry must reject, generated from it. The canary stands in for document
 * text: it is tried in every closed property and in properties that do not exist. Free
 * text is bounded where a survey declares it, so those cases go one character over.
 */
export function privacyCases(registry: Registry): PrivacyCase[] {
	const cases: PrivacyCase[] = [];
	for (const example of validExamples(registry)) {
		const def = registry[example.event];
		const add = (label: string, properties: PrivacyCase["properties"]) =>
			cases.push({
				event: example.event,
				origin: example.origin,
				label: `${example.event}: ${label}`,
				properties,
			});
		for (const name of LEAKY_NAMES) {
			add(`canary in undeclared property ${name}`, {
				...example.properties,
				[name]: CANARY,
			});
		}
		for (const [name, spec] of Object.entries(def.props)) {
			if (spec.kind === "text") {
				add(`text property ${name} over its bound`, {
					...example.properties,
					[name]: "x".repeat(spec.max + 1),
				});
			} else {
				add(`canary in ${spec.kind} property ${name}`, {
					...example.properties,
					[name]: CANARY,
				});
			}
		}
	}
	return cases;
}
