import {
	EVENTS,
	type EventRegistry,
	renderEventListMarkdown,
} from "@speeedy/contracts";

export interface EventProp {
	name: string;
	/** The value rule, as the Markdown writes it (inline code in backticks). */
	value: string;
	required: boolean;
}

export interface EventSection {
	name: string;
	/** The description and the "Sent by" line. */
	paragraphs: string[];
	props: EventProp[];
}

export interface EventListDocument {
	intro: string[];
	events: EventSection[];
}

const PROP_ROW = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*(yes|no)\s*\|$/;

/**
 * Reads the Markdown the registry generates into sections the page can lay out. The format is
 * the generator's own, so this reads that and nothing more: `## \`name\`` starts an event,
 * a run of text lines is a paragraph, and a `| \`prop\` | value | yes |` line is a property.
 */
export function eventListDocument(markdown: string): EventListDocument {
	const intro: string[] = [];
	const events: EventSection[] = [];
	let current: EventSection | undefined;
	let paragraph: string[] = [];

	const flush = (): void => {
		if (paragraph.length === 0) return;
		(current ? current.paragraphs : intro).push(paragraph.join(" "));
		paragraph = [];
	};

	for (const raw of markdown.split("\n")) {
		const line = raw.trim();
		if (line === "" || line.startsWith("<!--")) {
			flush();
			continue;
		}
		if (line.startsWith("## ")) {
			flush();
			current = {
				name: line.slice(3).replace(/^`|`$/g, ""),
				paragraphs: [],
				props: [],
			};
			events.push(current);
			continue;
		}
		if (line.startsWith("# ")) {
			flush();
			continue;
		}
		if (line.startsWith("|")) {
			flush();
			const row = PROP_ROW.exec(line);
			if (row?.[1] && current) {
				current.props.push({
					name: row[1],
					value: row[2] ?? "",
					required: row[3] === "yes",
				});
			}
			continue;
		}
		paragraph.push(line);
	}
	flush();
	return { intro, events };
}

/** The published event list, generated from the registry at build time. */
export function publishedEventList(
	registry: EventRegistry = EVENTS,
): EventListDocument {
	return eventListDocument(renderEventListMarkdown(registry));
}

/** Splits text on its backticks into plain and code parts. */
export function inlineParts(text: string): { text: string; code: boolean }[] {
	return text
		.split("`")
		.map((part, index) => ({ text: part, code: index % 2 === 1 }))
		.filter((part) => part.text !== "");
}
