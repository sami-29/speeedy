/**
 * What `/api/e` lets through. Every event and every property is declared here with a
 * closed shape: an enum, a bounded integer, a boolean or bounded text. Anything else is
 * rejected. The typed event registry (ticket 10) replaces this file with a generated one.
 */

export type PropSpec =
	| { kind: "enum"; values: readonly string[] }
	| { kind: "int"; min: number; max: number }
	| { kind: "bool" }
	| { kind: "text"; max: number };

export interface EventSpec {
	schemaVersion: number;
	props: Readonly<Record<string, PropSpec>>;
}

const bool: PropSpec = { kind: "bool" };

export const ALLOWLIST: ReadonlyMap<string, EventSpec> = new Map([
	[
		"feature_survey_answered",
		{
			schemaVersion: 1,
			props: {
				// The 11 ideas of the 1.x feature survey, each a yes or no.
				idea_listen_voices: bool,
				idea_sync: bool,
				idea_browser_button: bool,
				idea_speed_training: bool,
				idea_comprehension_check: bool,
				idea_photo_to_text: bool,
				idea_read_later: bool,
				idea_focus_settings: bool,
				idea_classroom: bool,
				idea_bilingual: bool,
				idea_ai_help: bool,
				// The one free-text property; only the survey form sends it.
				own_idea: { kind: "text", max: 500 },
				reads: {
					kind: "enum",
					values: [
						"articles",
						"books",
						"papers",
						"documents",
						"fiction",
						"news",
						"other",
					],
				},
			},
		},
	],
]);

export function isValidValue(spec: PropSpec, value: unknown): boolean {
	switch (spec.kind) {
		case "enum":
			return typeof value === "string" && spec.values.includes(value);
		case "int":
			return (
				Number.isInteger(value) &&
				(value as number) >= spec.min &&
				(value as number) <= spec.max
			);
		case "bool":
			return typeof value === "boolean";
		case "text":
			return typeof value === "string" && Array.from(value).length <= spec.max;
	}
}
