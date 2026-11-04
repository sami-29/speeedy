import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Headless Chromium has no browser voices, so these tests replace speechSynthesis with a
// stand-in that speaks on a timer. It can report word boundaries or, like Chrome's network
// voices, leave them out. What a real voice does is a manual check.

type StubConfig = {
	/** Report a boundary for each word. */
	boundaries: boolean;
	/** Milliseconds each word takes to say. */
	msPerWord: number;
	/** The voices appear this long after the page asks, as in Chrome. */
	voicesAfterMs: number;
	/** Leave speechSynthesis out of the page altogether. */
	missing: boolean;
};

type Spoken = {
	text: string;
	lang: string;
	voice: string | null;
	rate: number;
};

const DEFAULTS: StubConfig = {
	boundaries: true,
	msPerWord: 250,
	voicesAfterMs: 0,
	missing: false,
};

async function stubSpeech(page: Page, config: Partial<StubConfig> = {}) {
	await page.addInitScript(
		(given) => {
			const settings = given as StubConfig;
			const w = window as unknown as Record<string, unknown>;
			const define = (name: string, value: unknown) =>
				Object.defineProperty(window, name, { value, configurable: true });
			if (settings.missing) {
				define("speechSynthesis", undefined);
				define("SpeechSynthesisUtterance", undefined);
				return;
			}
			const all = [
				{
					voiceURI: "local-en-us",
					name: "Local English",
					lang: "en-US",
					localService: true,
					default: true,
				},
				{
					voiceURI: "local-en-gb",
					name: "British English",
					lang: "en-GB",
					localService: true,
					default: false,
				},
				{
					voiceURI: "local-fr",
					name: "Voix francaise",
					lang: "fr-FR",
					localService: true,
					default: false,
				},
			];
			let loaded = settings.voicesAfterMs === 0;
			const changed = new Set<() => void>();
			if (!loaded) {
				setTimeout(() => {
					loaded = true;
					for (const listener of [...changed]) listener();
				}, settings.voicesAfterMs);
			}
			const state = { spoken: [] as unknown[], cancels: 0, speaking: 0 };
			w.__speech = state;
			type Fake = {
				text: string;
				lang: string;
				voice: { voiceURI: string } | null;
				rate: number;
				onstart?: (event: unknown) => void;
				onboundary?: (event: unknown) => void;
				onend?: (event: unknown) => void;
				onerror?: (event: unknown) => void;
			};
			let timers: ReturnType<typeof setTimeout>[] = [];
			let current: Fake | null = null;
			class Utterance {
				lang = "";
				voice: unknown = null;
				rate = 1;
				pitch = 1;
				volume = 1;
				onstart: Fake["onstart"];
				onboundary: Fake["onboundary"];
				onend: Fake["onend"];
				onerror: Fake["onerror"];
				text: string;
				constructor(text: string) {
					this.text = text;
				}
			}
			define("SpeechSynthesisUtterance", Utterance);
			define("speechSynthesis", {
				speaking: false,
				pending: false,
				paused: false,
				getVoices: () => (loaded ? all : []),
				addEventListener: (type: string, listener: () => void) => {
					if (type === "voiceschanged") changed.add(listener);
				},
				removeEventListener: (type: string, listener: () => void) => {
					if (type === "voiceschanged") changed.delete(listener);
				},
				speak(utterance: Fake) {
					state.spoken.push({
						text: utterance.text,
						lang: utterance.lang,
						voice: utterance.voice ? utterance.voice.voiceURI : null,
						rate: utterance.rate,
					});
					current = utterance;
					state.speaking += 1;
					const words = [...utterance.text.matchAll(/\S+/g)];
					timers.push(
						setTimeout(() => utterance.onstart?.({}), 5),
						...words.map((word, i) =>
							setTimeout(
								() => {
									if (settings.boundaries) {
										utterance.onboundary?.({
											name: "word",
											charIndex: word.index ?? 0,
										});
									}
								},
								10 + i * settings.msPerWord,
							),
						),
						setTimeout(
							() => {
								current = null;
								utterance.onend?.({});
							},
							10 + words.length * settings.msPerWord,
						),
					);
				},
				cancel() {
					state.cancels += 1;
					for (const timer of timers) clearTimeout(timer);
					timers = [];
					const was = current;
					current = null;
					was?.onerror?.({ error: "canceled" });
				},
			});
		},
		{ ...DEFAULTS, ...config },
	);
}

const spoken = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __speech: { spoken: Spoken[] } }).__speech.spoken,
	);
const cancels = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __speech: { cancels: number } }).__speech.cancels,
	);

// Fifty sentences of three words: "s7a s7b s7c." The letter gives the place inside the
// sentence and the number the sentence.
const SENTENCES = Array.from(
	{ length: 50 },
	(_, i) => `s${i + 1}a s${i + 1}b s${i + 1}c.`,
).join(" ");

const ENGLISH =
	"The quick brown fox jumps over the lazy dog. We will see what happens when the rain stops and the sun comes out again. It is not a long text, but it has enough of the common words to be known by the reader.";

const pane = (page: Page) => page.getByTestId("listen");
const now = (page: Page) => pane(page).locator('[data-state="now"]');
const nowText = async (page: Page) =>
	(await now(page).allTextContents()).join("");
const word = (page: Page) => page.getByTestId("word");

const modeButton = (page: Page, name: string) =>
	page
		.getByRole("group", { name: "Reading Mode" })
		.getByRole("button", { name });

async function startPasted(page: Page, text: string = SENTENCES) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(text);
	await page.getByRole("button", { name: "Start" }).click();
	await expect(word(page)).toHaveText(/\S/);
}

/** Pasted text, paused at once, then in Listen and paused: the reader before any speech. */
async function openListen(page: Page, text: string = SENTENCES) {
	await startPasted(page, text);
	await page.getByRole("button", { name: "Pause" }).click();
	// RSVP read a few words before the pause: go back to the top of the text.
	await page.getByRole("button", { name: /Back one paragraph/ }).click();
	await modeButton(page, "Listen").click();
	await expect(pane(page)).toBeVisible();
}

test.describe("Listen with browser voices", () => {
	test("is a Reading Mode beside RSVP and Pacer", async ({ page }) => {
		await stubSpeech(page);
		await startPasted(page);
		await expect(
			page.getByRole("group", { name: "Reading Mode" }).getByRole("button"),
		).toHaveText(["RSVP", "Pacer", "Listen"]);
	});

	test("speaks one sentence at a time and highlights the word being spoken", async ({
		page,
	}) => {
		await stubSpeech(page);
		await startPasted(page);
		await modeButton(page, "Listen").click();
		await expect(pane(page)).toBeVisible();
		await expect
			.poll(async () => (await spoken(page)).length)
			.toBeGreaterThan(0);
		const first = (await spoken(page))[0] as Spoken;
		expect(first.text).toMatch(/\.$/);
		// Watch the highlight walk through a sentence a word at a time.
		const seen = new Set<string>();
		await expect
			.poll(
				async () => {
					const text = await nowText(page);
					if (text) seen.add(text);
					return [...seen].filter((t) => /^s\d+[abc]$/.test(t)).length;
				},
				{ timeout: 10_000, intervals: [50] },
			)
			.toBeGreaterThanOrEqual(3);
		// One sentence in flight: every sentence spoken so far is a single sentence.
		for (const entry of await spoken(page)) {
			expect(entry.text.match(/\./g)?.length).toBe(1);
		}
	});

	test("the highlighted word is the one the voice is on", async ({ page }) => {
		await stubSpeech(page, { msPerWord: 600 });
		await openListen(page);
		await page.getByRole("button", { name: "Play" }).click();
		await expect.poll(() => nowText(page)).toBe("s1a");
		await expect.poll(() => nowText(page)).toBe("s1b");
		await expect.poll(() => nowText(page)).toBe("s1c.");
		await expect.poll(() => nowText(page)).toBe("s2a");
	});

	test("without word boundaries it highlights the sentence and says so quietly", async ({
		page,
	}) => {
		await stubSpeech(page, { boundaries: false, msPerWord: 700 });
		await openListen(page);
		await page.getByRole("button", { name: "Play" }).click();
		await expect.poll(() => nowText(page)).toBe("s1a s1b s1c.");
		await expect(pane(page)).toHaveAttribute("data-granularity", "sentence");
		await expect(
			page.getByText("This voice highlights the sentence being read."),
		).toBeVisible({ timeout: 5000 });
		await expect
			.poll(() => nowText(page), { timeout: 10_000 })
			.toBe("s2a s2b s2c.");
	});

	test("never promises word sync in what it says", async ({ page }) => {
		await stubSpeech(page, { boundaries: false });
		await openListen(page);
		const text = (
			(await page.locator("main, body").first().textContent()) ?? ""
		).toLowerCase();
		expect(text).not.toMatch(/word[- ]?(by[- ]word )?sync|synced word|in sync/);
	});

	test("the voice speed and the voice choice are kept on this device", async ({
		page,
	}) => {
		await stubSpeech(page);
		await openListen(page);
		await page.getByRole("button", { name: "Faster voice" }).click();
		await page.getByRole("button", { name: "Faster voice" }).click();
		await expect(page.getByTestId("voice-rate")).toHaveText("1.2×");
		await page.getByLabel("Voice", { exact: true }).selectOption("local-en-gb");
		await page.getByRole("button", { name: "Play" }).click();
		await expect
			.poll(async () => (await spoken(page)).length)
			.toBeGreaterThan(0);
		const first = (await spoken(page))[0] as Spoken;
		expect(first.rate).toBe(1.2);
		expect(first.voice).toBe("local-en-gb");
		// A new visit: the Library reopens the text and the choices are still there.
		await page.reload();
		await expect(word(page)).toHaveText(/\S/);
		await page.getByRole("button", { name: "Pause" }).click();
		await modeButton(page, "Listen").click();
		await expect(page.getByTestId("voice-rate")).toHaveText("1.2×");
		await expect(page.getByLabel("Voice", { exact: true })).toHaveValue(
			"local-en-gb",
		);
	});

	test("a speed change while it plays carries on from the same place", async ({
		page,
	}) => {
		await stubSpeech(page, { msPerWord: 1500 });
		await openListen(page);
		await page.getByRole("button", { name: "Play" }).click();
		await expect
			.poll(() => nowText(page), { timeout: 15_000, intervals: [30] })
			.toBe("s1b");
		await page.getByRole("button", { name: "Faster voice" }).click();
		await expect.poll(async () => (await spoken(page)).at(-1)?.rate).toBe(1.1);
		// It starts again from the word it was on, not from the top of the text.
		expect((await spoken(page)).at(-1)?.text).toMatch(/^s1[bc]/);
		await expect.poll(() => nowText(page)).toMatch(/^s1[bc]\.?$/);
	});

	test("lists the voices even when the browser loads them late", async ({
		page,
	}) => {
		await stubSpeech(page, { voicesAfterMs: 400 });
		await openListen(page);
		const voice = page.getByLabel("Voice", { exact: true });
		await expect(voice.locator("option")).toContainText(
			["Browser default", "Local English", "British English"],
			{ timeout: 5000 },
		);
	});

	test("keeps playing when the tab is hidden", async ({ page }) => {
		await stubSpeech(page, { msPerWord: 150 });
		await startPasted(page);
		await modeButton(page, "Listen").click();
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
		const hide = () =>
			page.evaluate(() => {
				Object.defineProperty(document, "visibilityState", {
					configurable: true,
					get: () => "hidden",
				});
				document.dispatchEvent(new Event("visibilitychange"));
			});
		const before = (await spoken(page)).length;
		await hide();
		await page.waitForTimeout(300);
		await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
		await expect
			.poll(async () => (await spoken(page)).length, { timeout: 8000 })
			.toBeGreaterThan(before);
	});

	test("rewinds a sentence by speaking it again", async ({ page }) => {
		await stubSpeech(page, { msPerWord: 900 });
		await openListen(page);
		await page.getByRole("button", { name: "Play" }).click();
		await expect
			.poll(async () => (await spoken(page)).length)
			.toBeGreaterThan(1);
		await expect
			.poll(() => nowText(page), { timeout: 15_000, intervals: [50] })
			.toBe("s2b");
		const spokenSoFar = (await spoken(page)).length;
		// Part-way through a sentence, back goes to the start of that sentence...
		await page.getByRole("button", { name: /Back one sentence/ }).click();
		await expect
			.poll(async () => (await spoken(page)).length)
			.toBeGreaterThan(spokenSoFar);
		expect((await spoken(page)).at(-1)?.text).toBe("s2a s2b s2c.");
		// ...and from the start of one, to the sentence before.
		await page.getByRole("button", { name: /Back one sentence/ }).click();
		await expect
			.poll(async () => (await spoken(page)).at(-1)?.text)
			.toBe("s1a s1b s1c.");
	});

	test("RSVP, Pacer and Listen keep the Position through every switch", async ({
		page,
	}) => {
		await stubSpeech(page, { msPerWord: 500 });
		await openListen(page);
		await page.getByRole("button", { name: "Play" }).click();
		await expect.poll(() => nowText(page)).toBe("s1b");
		await page.getByRole("button", { name: "Pause" }).click();
		const held = await nowText(page);
		await modeButton(page, "Pacer").click();
		await expect(page.getByTestId("pacer")).toBeVisible();
		await expect(
			page.getByTestId("pacer").locator('[data-state="now"]'),
		).toHaveText(held);
		await modeButton(page, "RSVP").click();
		await expect(word(page)).toHaveText(held);
		await modeButton(page, "Listen").click();
		await expect(pane(page)).toBeVisible();
		await expect.poll(() => nowText(page)).toMatch(/^s1[abc]/);
	});

	test("leaving Listen stops the voice and starts nothing new", async ({
		page,
	}) => {
		await stubSpeech(page, { msPerWord: 200 });
		await startPasted(page);
		await modeButton(page, "Listen").click();
		await expect
			.poll(async () => (await spoken(page)).length)
			.toBeGreaterThan(0);
		const before = await cancels(page);
		await modeButton(page, "RSVP").click();
		await expect(pane(page)).toHaveCount(0);
		expect(await cancels(page)).toBeGreaterThan(before);
		const count = (await spoken(page)).length;
		await page.waitForTimeout(800);
		expect((await spoken(page)).length).toBe(count);
	});

	test("a French document gets the French voice, and the page says so", async ({
		page,
	}) => {
		await stubSpeech(page);
		const french =
			"Le chat est assis sur le tapis et regarde par la fenetre. Il pleut depuis ce matin, et les enfants sont restes a la maison pour jouer avec leurs amis. Nous irons au marche demain si le temps le permet.";
		await openListen(page, french);
		await page.getByRole("button", { name: "Play" }).click();
		await expect
			.poll(async () => (await spoken(page)).length)
			.toBeGreaterThan(0);
		const first = (await spoken(page))[0] as Spoken;
		expect(first.lang).toBe("fr");
		expect(first.voice).toBe("local-fr");
		await expect(page.getByTestId("listen-note")).toContainText(
			/French.*Voix francaise|Voix francaise.*French/,
		);
	});

	test("an English document needs no note about the voice", async ({
		page,
	}) => {
		await stubSpeech(page);
		await openListen(page);
		await expect(page.getByTestId("listen-note")).toHaveCount(0);
	});

	test("says plainly when the browser cannot read aloud", async ({ page }) => {
		await stubSpeech(page, { missing: true });
		await startPasted(page);
		await modeButton(page, "Listen").click();
		await expect(
			page.getByText("This browser cannot read aloud"),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
	});
});

test.describe("Listen start", () => {
	test("sends the document's language as a listed value and no text", async ({
		page,
	}) => {
		await stubSpeech(page);
		const events: { event: string; properties: Record<string, unknown> }[] = [];
		await page.route("**/api/e", async (route) => {
			const body = route.request().postDataJSON() as { events: typeof events };
			events.push(...body.events);
			await route.fulfill({ status: 204 });
		});
		await startPasted(page, ENGLISH);
		await modeButton(page, "Listen").click();
		await expect
			.poll(() => events.filter((e) => e.event === "listen_start").length, {
				timeout: 10_000,
			})
			.toBe(1);
		const sent = events.find((e) => e.event === "listen_start");
		expect(sent?.properties).toMatchObject({ document_language: "en" });
		expect(JSON.stringify(sent)).not.toMatch(/fox|rain|sun/i);
		// Pausing and playing again is not another start.
		await page.getByRole("button", { name: "Pause" }).click();
		await page.getByRole("button", { name: "Play" }).click();
		await page.waitForTimeout(500);
		expect(events.filter((e) => e.event === "listen_start")).toHaveLength(1);
	});
});

test.describe("accessibility and fit", () => {
	for (const viewport of [
		{ name: "390px", width: 390, height: 844 },
		{ name: "desktop", width: 1280, height: 800 },
	]) {
		test(`axe passes on Listen at ${viewport.name}, and it fits`, async ({
			page,
		}) => {
			await stubSpeech(page, { voicesAfterMs: 100 });
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await openListen(page);
			await expect(
				page.getByLabel("Voice", { exact: true }).locator("option"),
			).toHaveCount(4);
			await page.evaluate(() => document.fonts.ready);
			const results = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
				.analyze();
			expect(results.violations).toEqual([]);
			const fits = await page.evaluate(() => ({
				page: document.documentElement.scrollWidth <= window.innerWidth,
				pane:
					(document
						.querySelector('[data-testid="listen"]')
						?.getBoundingClientRect().right ?? 0) <= window.innerWidth,
			}));
			expect(fits).toEqual({ page: true, pane: true });
		});
	}

	test("axe passes on Listen in the Night theme while it plays", async ({
		page,
	}) => {
		await stubSpeech(page, { boundaries: false, msPerWord: 800 });
		await openListen(page);
		await page.getByRole("button", { name: "Night theme" }).click();
		await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
		await page.getByRole("button", { name: "Play" }).click();
		await expect(now(page).first()).toBeVisible();
		await expect(
			page.getByText("This voice highlights the sentence being read."),
		).toBeVisible({ timeout: 5000 });
		// The chrome dims while a Session plays; the check is of the page at rest.
		await page.getByRole("button", { name: "Pause" }).click();
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
			.analyze();
		expect(results.violations).toEqual([]);
	});
});
