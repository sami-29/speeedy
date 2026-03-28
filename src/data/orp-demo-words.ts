export type OrpDemoWord = readonly [
	word: string,
	before: string,
	pivot: string,
	after: string,
];

export const ORP_DEMO_WORDS: readonly OrpDemoWord[] = [
	["Your", "Y", "o", "ur"],
	["brain", "b", "r", "ain"],
	["reads", "r", "e", "ads"],
	["faster", "fa", "s", "ter"],
	["than", "t", "h", "an"],
	["your", "y", "o", "ur"],
	["eyes", "e", "y", "es"],
	["move.", "m", "o", "ve."],
];
