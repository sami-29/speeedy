/**
 * The sources the /learn articles cite, every one taken from the reading-science research
 * note (checked 2026-10-19; each DOI resolved against Crossref). A reference carries only what
 * the note gives: authors, year, journal, volume and pages, and the title where the note has
 * it. An article may state a number only if it is listed in that source's `figures`, so a
 * figure cannot drift away from the paper it came from. Add a source here only after reading
 * it in the note.
 */

/** How much of the paper the note could read. */
export type Access = "full" | "abstract" | "highlights" | "review";

export type SourceId =
	| "rayner2016"
	| "brysbaert2019"
	| "rubin1992"
	| "primativo2016"
	| "benedetto2015"
	| "ricciardi2017"
	| "oquist2003"
	| "masson1983"
	| "schotter2014"
	| "oregan1992"
	| "rayner1998"
	| "snell2024"
	| "parker2026"
	| "moussaoui2025"
	| "breznitz2013";

export type Source = {
	id: SourceId;
	/** How the text names it: "Rayner et al." */
	short: string;
	year: number;
	/** The reference as the note gives it, without the DOI. */
	citation: string;
	doi: string;
	/** Every number the note gives for this paper, as the articles write it. */
	figures: readonly string[];
	access: Access;
};

export const SOURCES: Record<SourceId, Source> = {
	rayner2016: {
		id: "rayner2016",
		short: "Rayner et al.",
		year: 2016,
		citation:
			"Rayner, Schotter, Masson, Potter & Treiman (2016). So Much to Read, So Little Time: How Do We Read, and Can Speed Reading Help? Psychological Science in the Public Interest 17(1), 4–34.",
		doi: "10.1177/1529100615623267",
		figures: ["250", "500", "750"],
		access: "full",
	},
	brysbaert2019: {
		id: "brysbaert2019",
		short: "Brysbaert",
		year: 2019,
		citation: "Brysbaert (2019). Journal of Memory and Language 109, 104047.",
		doi: "10.1016/j.jml.2019.104047",
		figures: ["238", "260", "190", "18,573", "175", "300"],
		access: "full",
	},
	rubin1992: {
		id: "rubin1992",
		short: "Rubin & Turano",
		year: 1992,
		citation: "Rubin & Turano (1992). Vision Research 32(5), 895–902.",
		doi: "10.1016/0042-6989(92)90032-E",
		figures: ["13", "1171", "303", "6", "1652", "75"],
		access: "full",
	},
	primativo2016: {
		id: "primativo2016",
		short: "Primativo et al.",
		year: 2016,
		citation: "Primativo et al. (2016). PLOS ONE 11(4), e0153786.",
		doi: "10.1371/journal.pone.0153786",
		figures: ["100", "1500", "250", "300"],
		access: "full",
	},
	benedetto2015: {
		id: "benedetto2015",
		short: "Benedetto et al.",
		year: 2015,
		citation:
			"Benedetto et al. (2015). Computers in Human Behavior 45, 352–358.",
		doi: "10.1016/j.chb.2014.12.043",
		figures: [],
		access: "abstract",
	},
	ricciardi2017: {
		id: "ricciardi2017",
		short: "Ricciardi & Di Nocera",
		year: 2017,
		citation:
			"Ricciardi & Di Nocera (2017). Not so fast: A reply to Benedetto et al. (2015). Computers in Human Behavior 69, 381–385.",
		doi: "10.1016/j.chb.2016.12.047",
		figures: ["172", "250"],
		access: "highlights",
	},
	oquist2003: {
		id: "oquist2003",
		short: "Öquist & Goldstein",
		year: 2003,
		citation:
			"Öquist & Goldstein (2003). Interacting with Computers 15(4), 539–558.",
		doi: "10.1016/S0953-5438(03)00039-0",
		figures: ["33", "16"],
		access: "full",
	},
	masson1983: {
		id: "masson1983",
		short: "Masson",
		year: 1983,
		citation: "Masson (1983). Memory & Cognition 11(3), 262–274.",
		doi: "10.3758/BF03196973",
		figures: [],
		access: "review",
	},
	schotter2014: {
		id: "schotter2014",
		short: "Schotter et al.",
		year: 2014,
		citation:
			"Schotter, Tran & Rayner (2014). Psychological Science 25(6), 1218–1226.",
		doi: "10.1177/0956797614531148",
		figures: ["40"],
		access: "full",
	},
	oregan1992: {
		id: "oregan1992",
		short: "O’Regan & Jacobs",
		year: 1992,
		citation:
			"O’Regan & Jacobs (1992). Journal of Experimental Psychology: Human Perception and Performance 18(1), 185–197.",
		doi: "10.1037/0096-1523.18.1.185",
		figures: [],
		access: "full",
	},
	rayner1998: {
		id: "rayner1998",
		short: "Rayner",
		year: 1998,
		citation: "Rayner (1998). Psychological Bulletin 124(3), 372–422.",
		doi: "10.1037/0033-2909.124.3.372",
		figures: ["10"],
		access: "full",
	},
	snell2024: {
		id: "snell2024",
		short: "Snell",
		year: 2024,
		citation:
			"Snell (2024). No, Bionic Reading does not work. Acta Psychologica 247, 104304.",
		doi: "10.1016/j.actpsy.2024.104304",
		figures: ["100"],
		access: "full",
	},
	parker2026: {
		id: "parker2026",
		short: "Parker et al.",
		year: 2026,
		citation:
			"Parker, Wang, Lee & Joseph (2026). Royal Society Open Science 13.",
		doi: "10.1098/rsos.250177",
		figures: ["90"],
		access: "full",
	},
	moussaoui2025: {
		id: "moussaoui2025",
		short: "Moussaoui et al.",
		year: 2025,
		citation:
			"Moussaoui, Siddiqi, Cheung & Niemeier (2025). Reading without eye movements: Improving reading comprehension in young adults with ADHD. Journal of the International Neuropsychological Society 31(9–10), 731–742.",
		doi: "10.1017/S1355617725101628",
		figures: ["38", "200", "7", "6", "13"],
		access: "full",
	},
	breznitz2013: {
		id: "breznitz2013",
		short: "Breznitz et al.",
		year: 2013,
		citation: "Breznitz et al. (2013). Nature Communications 4, 1486.",
		doi: "10.1038/ncomms2488",
		figures: ["6"],
		access: "full",
	},
};
