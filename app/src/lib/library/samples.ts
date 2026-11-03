import type { Block, Document } from "@speeedy/contracts";

/** A document that ships with the app, for a reader who has nothing of their own yet. */
export type Sample = {
	id: string;
	title: string;
	language: "en";
	document: Document;
};

const heading = (text: string): Block => ({
	kind: "heading",
	level: 1,
	text,
	spans: [],
});

const paragraph = (text: string): Block => ({
	kind: "paragraph",
	text,
	spans: [],
});

const sample = (
	id: string,
	title: string,
	...paragraphs: string[]
): Sample => ({
	id,
	title,
	language: "en",
	document: {
		version: 1,
		blocks: [heading(title), ...paragraphs.map(paragraph)],
	},
});

export const SAMPLES: readonly Sample[] = [
	sample(
		"welcome",
		"Welcome to Speeedy",
		"This is a sample. Speeedy shows you one word at a time in the same spot on the screen, so your eyes stay still and the words come to you. The red letter in each word is where your eye lands best.",
		"Press Pause whenever you like. Your place is kept, and so is the text: close the tab, come back tomorrow, and the Reader opens where you stopped.",
		"Everything you read is saved in your Library, on this device. Paste an article, drop in a file, or pick another sample, and each one keeps its own place. Nothing you read is sent anywhere.",
		"Try a faster speed once this one feels easy. Most people can follow far more words per minute than they expect, and the numbers climb quickly with a little practice.",
	),
	sample(
		"the-lighthouse",
		"The lighthouse keeper's morning",
		"Before the sun was up, Marta climbed the one hundred and twelve steps to the lamp room, as she had every morning for nineteen years. The stairs were cold, and the iron rail was wet with the night's fog.",
		"At the top she put out the great lamp. The glass was still warm. Below her the sea was the colour of slate, and a single gull stood on the rail of the gallery, watching her with one round eye.",
		"She wrote the night's entry in the log. Wind from the west, light rain after midnight, two ships passed at a distance, nothing to report. It was the same entry she had written the day before, and she liked that about it.",
		"Then she made tea, and carried the cup out to the gallery, and stood in the grey light while the fog lifted off the water. Somewhere far out a ship's horn sounded, low and patient, and she raised her cup to it.",
	),
	sample(
		"why-eyes-stop",
		"Why your eyes keep stopping",
		"When you read a page, your eyes do not glide along the line. They jump from one spot to the next, and in between they are almost blind. Each pause lasts about a quarter of a second, and only during a pause do you take in any letters at all.",
		"Most of the time a reader spends is not in the jumps. It is in the pauses, and in the small steps back when something was missed. Moving the words to the eye, instead of the eye to the words, removes the jumps and most of the steps back.",
		"What it does not remove is the thinking. Understanding a sentence still takes time, and a very high speed leaves too little of it. That is why Speeedy tells you what kind of reading each speed is good for: study, ordinary reading, or skimming.",
		"The best speed is the fastest one at which you still remember what you read. It is different for a novel and for a textbook, and it moves as you practise.",
	),
];

export const sampleById = (id: string): Sample | undefined =>
	SAMPLES.find((candidate) => candidate.id === id);
