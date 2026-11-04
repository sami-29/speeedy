import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Headless Chromium has an AudioContext but nobody to hear it, so these tests replace it with
// a stand-in that records what the page builds and asks of it. How it sounds is a manual check.

type Stub = {
	contexts: number;
	resumes: number;
	sources: number;
	loopingSources: number;
	stoppedSources: number;
	oscillators: number;
	state: string;
	/** Where the ambient bed's fade and duck gains are heading. */
	fade: number | null;
	duck: number | null;
	closed: number;
};

async function stubAudio(page: Page, options: { blocked?: boolean } = {}) {
	await page.addInitScript((given) => {
		const w = window as unknown as Record<string, unknown>;
		const record = {
			contexts: [] as unknown[],
			resumes: 0,
			sources: [] as { loop: boolean; stopped: boolean; to: unknown }[],
			oscillators: 0,
			closed: 0,
			blocked: given.blocked,
		};
		w.__audio = record;
		class Param {
			value: number;
			target: number;
			constructor(v: number) {
				this.value = v;
				this.target = v;
			}
			setValueAtTime(v: number) {
				this.value = v;
				this.target = v;
				return this;
			}
			linearRampToValueAtTime(v: number) {
				this.target = v;
				return this;
			}
			setTargetAtTime(v: number) {
				this.target = v;
				return this;
			}
			cancelScheduledValues() {
				return this;
			}
		}
		class Node {
			to: unknown = null;
			connect(next: unknown) {
				this.to = next;
				return next;
			}
			disconnect() {}
		}
		class Gain extends Node {
			gain = new Param(1);
		}
		class Source extends Node {
			buffer: unknown = null;
			loop = false;
			entry = { loop: false, stopped: false, to: null as unknown };
			start() {
				this.entry.loop = this.loop;
				this.entry.to = this;
				record.sources.push(this.entry);
			}
			stop() {
				this.entry.stopped = true;
			}
		}
		class Oscillator extends Node {
			type = "sine";
			frequency = new Param(440);
			start() {
				record.oscillators += 1;
			}
			stop() {}
		}
		class Context {
			state = "suspended";
			sampleRate = 8000;
			outputLatency = 0.01;
			destination = new Node();
			listeners = new Set<() => void>();
			private began = performance.now();
			get currentTime() {
				return this.state === "running"
					? (performance.now() - this.began) / 1000
					: 0;
			}
			constructor() {
				record.contexts.push(this);
			}
			createGain() {
				return new Gain();
			}
			createBufferSource() {
				return new Source();
			}
			createOscillator() {
				return new Oscillator();
			}
			createBuffer(_c: number, length: number) {
				return { getChannelData: () => new Float32Array(length) };
			}
			async resume() {
				record.resumes += 1;
				if (record.blocked) return;
				this.setState("running");
			}
			async close() {
				record.closed += 1;
				this.setState("closed");
			}
			addEventListener(_t: string, fn: () => void) {
				this.listeners.add(fn);
			}
			removeEventListener(_t: string, fn: () => void) {
				this.listeners.delete(fn);
			}
			setState(next: string) {
				this.state = next;
				for (const fn of [...this.listeners]) fn();
			}
		}
		Object.defineProperty(window, "AudioContext", {
			value: Context,
			configurable: true,
		});
		Object.defineProperty(window, "webkitAudioContext", {
			value: undefined,
			configurable: true,
		});
	}, options);
}

/** A voice that starts and never ends, enough for Listen to be speaking. */
async function stubVoice(page: Page) {
	await page.addInitScript(() => {
		class Utterance {
			lang = "";
			voice: unknown = null;
			rate = 1;
			volume = 1;
			onstart?: (event: unknown) => void;
			text: string;
			constructor(text: string) {
				this.text = text;
			}
		}
		Object.defineProperty(window, "SpeechSynthesisUtterance", {
			value: Utterance,
			configurable: true,
		});
		Object.defineProperty(window, "speechSynthesis", {
			value: {
				getVoices: () => [],
				addEventListener() {},
				removeEventListener() {},
				speak(utterance: Utterance) {
					setTimeout(() => utterance.onstart?.({}), 5);
				},
				cancel() {},
			},
			configurable: true,
		});
	});
}

const stub = (page: Page): Promise<Stub> =>
	page.evaluate(() => {
		type Rec = {
			contexts: { state: string; setState(s: string): void }[];
			resumes: number;
			sources: { loop: boolean; stopped: boolean; to: unknown }[];
			oscillators: number;
			closed: number;
		};
		const record = (window as unknown as { __audio: Rec }).__audio;
		const last = record.sources[record.sources.length - 1];
		type G = { gain: { target: number }; to: G | null };
		const fade = (last?.to as { to: G | null } | undefined)?.to ?? null;
		const duck = fade?.to ?? null;
		return {
			contexts: record.contexts.length,
			resumes: record.resumes,
			sources: record.sources.length,
			loopingSources: record.sources.filter((s) => s.loop).length,
			stoppedSources: record.sources.filter((s) => s.stopped).length,
			oscillators: record.oscillators,
			state: record.contexts[0]?.state ?? "none",
			fade: fade ? fade.gain.target : null,
			duck: duck ? duck.gain.target : null,
			closed: record.closed,
		};
	});

const SENTENCES = Array.from(
	{ length: 40 },
	(_, i) => `s${i + 1}a s${i + 1}b s${i + 1}c.`,
).join(" ");

async function startPasted(page: Page) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(SENTENCES);
	await page.getByRole("button", { name: "Start" }).click();
	await page.getByRole("group", { name: "Sound" }).waitFor();
}

const modeButton = (page: Page, name: string) =>
	page
		.getByRole("group", { name: "Reading Mode" })
		.getByRole("button", { name });
const ambient = (page: Page) =>
	page.getByLabel("Ambient noise", { exact: true });
const toggle = (page: Page) =>
	page.getByTestId("controls").getByRole("button", { name: /^(Play|Pause)$/ });

// A pasted text starts playing at once, so a test says which state it wants.
async function play(page: Page) {
	if ((await toggle(page).textContent())?.trim() === "Play") {
		await toggle(page).click();
	}
	await expect(toggle(page)).toHaveText("Pause");
}
async function pause(page: Page) {
	if ((await toggle(page).textContent())?.trim() === "Pause") {
		await toggle(page).click();
	}
	await expect(toggle(page)).toHaveText("Play");
}

test.describe("sound", () => {
	test("makes no audio context for a reader who asked for no sound", async ({
		page,
	}) => {
		await stubAudio(page);
		await startPasted(page);
		await pause(page);
		await play(page);
		await page.waitForTimeout(300);
		expect((await stub(page)).contexts).toBe(0);
	});

	test("ambient noise plays while reading, in one context, and fades on pause", async ({
		page,
	}) => {
		await stubAudio(page);
		await startPasted(page);
		await pause(page);
		await ambient(page).selectOption("pink");
		expect((await stub(page)).contexts).toBe(0);
		await play(page);
		await expect.poll(async () => (await stub(page)).loopingSources).toBe(1);
		let seen = await stub(page);
		expect(seen.contexts).toBe(1);
		expect(seen.state).toBe("running");
		expect(seen.fade).toBe(1);
		await pause(page);
		await expect.poll(async () => (await stub(page)).fade).toBe(0);
		seen = await stub(page);
		expect(seen.contexts).toBe(1);
		await play(page);
		await expect.poll(async () => (await stub(page)).fade).toBe(1);
		expect((await stub(page)).contexts).toBe(1);
	});

	test("ambient noise plays in Listen too, and ducks under the voice", async ({
		page,
	}) => {
		await stubAudio(page);
		await stubVoice(page);
		await startPasted(page);
		await ambient(page).selectOption("brown");
		await modeButton(page, "Listen").click();
		await expect(page.getByTestId("listen")).toBeVisible();
		await play(page);
		await expect
			.poll(async () => (await stub(page)).loopingSources)
			.toBeGreaterThan(0);
		await expect.poll(async () => (await stub(page)).duck).toBeLessThan(0.5);
		await pause(page);
		await expect.poll(async () => (await stub(page)).duck).toBe(1);
	});

	test("does not duck in a silent mode", async ({ page }) => {
		await stubAudio(page);
		await startPasted(page);
		await pause(page);
		await ambient(page).selectOption("white");
		await play(page);
		await expect.poll(async () => (await stub(page)).loopingSources).toBe(1);
		await page.waitForTimeout(200);
		expect((await stub(page)).duck).toBe(1);
	});

	test("ticks on each word in a silent mode when asked, and stops on pause", async ({
		page,
	}) => {
		await stubAudio(page);
		await startPasted(page);
		await pause(page);
		await page.getByLabel("Tick on each word").check();
		await play(page);
		await expect
			.poll(async () => (await stub(page)).oscillators)
			.toBeGreaterThan(2);
		await pause(page);
		const paused = (await stub(page)).oscillators;
		await page.waitForTimeout(600);
		expect((await stub(page)).oscillators).toBe(paused);
	});

	test("offers the tick only where nothing is spoken, and the voice volume only where something is", async ({
		page,
	}) => {
		await stubAudio(page);
		await stubVoice(page);
		await startPasted(page);
		await expect(page.getByLabel("Tick on each word")).toBeVisible();
		await expect(page.getByTestId("voice-volume")).toHaveCount(0);
		await modeButton(page, "Listen").click();
		await expect(page.getByTestId("listen")).toBeVisible();
		await expect(page.getByLabel("Tick on each word")).toHaveCount(0);
		await expect(page.getByTestId("voice-volume")).toBeVisible();
		await expect(ambient(page)).toBeVisible();
	});

	test("keeps the sound settings on this device and never sends them", async ({
		page,
	}) => {
		await stubAudio(page);
		const requests: string[] = [];
		page.on("request", (request) => requests.push(request.url()));
		await startPasted(page);
		await ambient(page).selectOption("white");
		for (let i = 0; i < 3; i++) {
			await page.getByRole("button", { name: "Louder ambient noise" }).click();
		}
		await expect(page.getByTestId("ambient-volume")).toHaveText("60%");
		await page.getByLabel("Tick on each word").check();
		const saved = await page.evaluate(() =>
			localStorage.getItem("speeedy.audio"),
		);
		expect(JSON.parse(saved ?? "{}")).toMatchObject({
			ambient: "white",
			tick: true,
			volumes: { ambient: 0.6 },
		});
		await page.reload();
		// The reader comes back with the text it had.
		await page.getByRole("group", { name: "Sound" }).waitFor();
		await expect(ambient(page)).toHaveValue("white");
		await expect(page.getByLabel("Tick on each word")).toBeChecked();
		await pause(page);
		await play(page);
		await expect
			.poll(async () => (await stub(page)).loopingSources)
			.toBeGreaterThan(0);
		// Nothing about sound leaves the page: no audio files, no request that names it.
		const origin = new URL(page.url()).origin;
		for (const url of requests) {
			expect(url.startsWith(origin) || url.startsWith("data:")).toBe(true);
			expect(url).not.toMatch(/\.(mp3|ogg|wav|m4a|aac)(\?|$)/);
			expect(new URL(url).search).not.toMatch(/ambient|volume|tick/i);
		}
	});

	test("starts the context on the first gesture when the browser held it back", async ({
		page,
	}) => {
		await stubAudio(page, { blocked: true });
		await startPasted(page);
		await pause(page);
		await ambient(page).selectOption("pink");
		await play(page);
		await expect
			.poll(async () => (await stub(page)).resumes)
			.toBeGreaterThan(0);
		expect((await stub(page)).state).toBe("suspended");
		await page.evaluate(() => {
			(window as unknown as { __audio: { blocked: boolean } }).__audio.blocked =
				false;
		});
		await page.getByTestId("controls").click({ position: { x: 2, y: 2 } });
		await expect.poll(async () => (await stub(page)).state).toBe("running");
		expect((await stub(page)).contexts).toBe(1);
	});

	test("resumes after the system interrupts the context, when the page comes back", async ({
		page,
	}) => {
		await stubAudio(page);
		await startPasted(page);
		await ambient(page).selectOption("pink");
		await play(page);
		await expect.poll(async () => (await stub(page)).state).toBe("running");
		const before = (await stub(page)).resumes;
		await page.evaluate(() => {
			const record = (
				window as unknown as {
					__audio: { contexts: { setState(s: string): void }[] };
				}
			).__audio;
			record.contexts[0]?.setState("interrupted");
			window.dispatchEvent(new Event("focus"));
		});
		await expect.poll(async () => (await stub(page)).state).toBe("running");
		expect((await stub(page)).resumes).toBeGreaterThan(before);
	});

	test("leaving the reader fades the noise out", async ({ page }) => {
		await stubAudio(page);
		await startPasted(page);
		await ambient(page).selectOption("pink");
		await expect.poll(async () => (await stub(page)).fade).toBe(1);
		await page.getByRole("button", { name: "New text" }).click();
		await expect.poll(async () => (await stub(page)).fade).toBe(0);
	});

	for (const viewport of [
		{ name: "390px", width: 390, height: 844 },
		{ name: "desktop", width: 1280, height: 800 },
	]) {
		for (const mode of ["RSVP", "Listen"]) {
			test(`axe passes on the sound settings in ${mode} at ${viewport.name}, and they fit`, async ({
				page,
			}) => {
				await stubAudio(page);
				await stubVoice(page);
				await page.setViewportSize({
					width: viewport.width,
					height: viewport.height,
				});
				await startPasted(page);
				await modeButton(page, mode).click();
				const group = page.getByRole("group", { name: "Sound" });
				await group.scrollIntoViewIfNeeded();
				await expect(group).toBeVisible();
				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth >
						document.documentElement.clientWidth,
				);
				expect(overflow).toBe(false);
				const results = await new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
					.analyze();
				expect(results.violations).toEqual([]);
			});
		}
	}
});
