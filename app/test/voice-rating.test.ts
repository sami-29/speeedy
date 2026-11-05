import { describe, expect, it } from "vitest";
import {
	createVoiceRating,
	RATING_AFTER_SECONDS,
} from "../src/lib/voice/rating.ts";

describe("The moment to ask the reader how the voice sounds", () => {
	it("comes once the reader has heard half a minute of the on-device voice", () => {
		const rating = createVoiceRating();
		const moments: { voice: string; seconds: number }[] = [];
		rating.subscribe((moment) => moments.push(moment));
		rating.played("kokoro", 20);
		expect(moments).toEqual([]);
		rating.played("kokoro", 11);
		expect(moments).toEqual([{ voice: "kokoro", seconds: 31 }]);
		expect(RATING_AFTER_SECONDS).toBe(30);
	});

	it("comes only once a visit", () => {
		const rating = createVoiceRating();
		let count = 0;
		rating.subscribe(() => count++);
		rating.played("kokoro", 40);
		rating.played("kokoro", 40);
		expect(count).toBe(1);
	});

	it("ignores nonsense amounts", () => {
		const rating = createVoiceRating();
		let count = 0;
		rating.subscribe(() => count++);
		rating.played("kokoro", Number.NaN);
		rating.played("kokoro", -100);
		rating.played("kokoro", Number.POSITIVE_INFINITY);
		expect(count).toBe(0);
	});

	it("stops telling a listener that has left", () => {
		const rating = createVoiceRating();
		let count = 0;
		const stop = rating.subscribe(() => count++);
		stop();
		rating.played("kokoro", 40);
		expect(count).toBe(0);
	});
});
