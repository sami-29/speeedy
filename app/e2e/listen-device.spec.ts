import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The on-device voice in Listen, with a stand-in for its worker: CI never downloads the model.
// The stand-in speaks the worker's protocol and makes a quiet tone for each word, so the real
// speaker, audio Clock and Listener run. How the real model sounds is a manual check.
//
// The service worker is blocked so the page's own routes see the worker request; the
// service worker's voice route has its own test in pwa.spec.ts.
test.use({ serviceWorkers: "block" });

const MODEL_HOSTS = /huggingface\.co|hf\.co|raw\.githubusercontent\.com/;
const KOKORO_URI = "speeedy:kokoro/af_msa";

const ENGLISH =
	"The quick brown fox jumps over the lazy dog. We will see what happens when the rain stops and the sun comes out again. It is not a long text, but it has enough of the common words to be known by the reader.";

/** The worker stand-in. `fail` answers every sentence with a failure. */
const stubWorker = (mode: "ok" | "fail") => `
const RATE = 24000;
const EACH = 0.3;
const MODE = ${JSON.stringify(mode)};
const post = (message, transfer) => self.postMessage(message, transfer ?? []);
self.addEventListener("message", ({ data }) => {
	switch (data.type) {
		case "status":
			post({ type: "status", downloaded: false, totalBytes: 37271123, totalLabel: "37.3 MB", threads: 1, crossOriginIsolated: true });
			return;
		case "download":
			post({ type: "progress", loaded: 12000000, totalBytes: 37271123 });
			setTimeout(() => post({ type: "ready", threads: 1, crossOriginIsolated: true }), 600);
			return;
		case "load":
			post({ type: "ready", threads: 1, crossOriginIsolated: true });
			return;
		case "cancel":
			return;
		case "generate": {
			if (MODE === "fail") {
				post({ type: "error", id: data.id, code: "failed", message: "stand-in failure" });
				return;
			}
			const speed = Math.min(data.speed ?? 1, 1.5);
			const each = EACH / speed;
			const words = [...data.sentence.matchAll(/\\S+/g)];
			const samples = new Float32Array(Math.round(words.length * each * RATE));
			for (let i = 0; i < samples.length; i++) samples[i] = 0.01 * Math.sin(i / 20);
			post({
				type: "result",
				id: data.id,
				ms: 20,
				result: {
					samples,
					sampleRate: RATE,
					durations: [],
					phonemes: "",
					words: words.map((word, i) => ({ text: word[0], start: i * each, end: (i + 1) * each })),
					speed,
				},
			}, [samples.buffer]);
			return;
		}
	}
});
`;

/** Browser voices that record what they are asked to say and finish each sentence quickly. */
async function stubSpeech(page: Page) {
	await page.addInitScript(() => {
		const define = (name: string, value: unknown) =>
			Object.defineProperty(window, name, { value, configurable: true });
		const voices = [
			{
				voiceURI: "local-en-us",
				name: "Local English",
				lang: "en-US",
				localService: true,
				default: true,
			},
		];
		const spoken: string[] = [];
		(window as unknown as { __spoken: string[] }).__spoken = spoken;
		type Fake = {
			text: string;
			onstart?: (event: unknown) => void;
			onend?: (event: unknown) => void;
			onerror?: (event: unknown) => void;
		};
		let current: Fake | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		class Utterance {
			lang = "";
			voice: unknown = null;
			rate = 1;
			pitch = 1;
			volume = 1;
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
			getVoices: () => voices,
			addEventListener: () => {},
			removeEventListener: () => {},
			speak(utterance: Fake) {
				spoken.push(utterance.text);
				current = utterance;
				setTimeout(() => utterance.onstart?.({}), 5);
				timer = setTimeout(() => {
					current = null;
					utterance.onend?.({});
				}, 400);
			},
			cancel() {
				clearTimeout(timer);
				const was = current;
				current = null;
				was?.onerror?.({ error: "canceled" });
			},
		});
	});
}

/** Requests the page made to a model host or for the voice worker. */
function watchVoiceRequests(page: Page) {
	const seen: string[] = [];
	page.on("request", (request) => {
		const url = request.url();
		if (MODEL_HOSTS.test(url) || /kokoro\.worker-/.test(url)) seen.push(url);
	});
	return seen;
}

async function serveWorker(page: Page, mode: "ok" | "fail") {
	await page.route("**/kokoro.worker-*.js", (route) =>
		route.fulfill({
			status: 200,
			contentType: "text/javascript",
			// As production serves it (static/_headers): a worker under an isolated page needs it.
			headers: { "Cross-Origin-Embedder-Policy": "credentialless" },
			body: stubWorker(mode),
		}),
	);
	await page.route(MODEL_HOSTS, (route) => route.abort());
}

const pane = (page: Page) => page.getByTestId("listen");
const nowText = async (page: Page) =>
	(await pane(page).locator('[data-state="now"]').allTextContents()).join("");
const voiceSelect = (page: Page) => page.getByLabel("Voice", { exact: true });

async function openListen(page: Page) {
	await page.goto("/reader");
	await page.getByRole("textbox", { name: "Text to read" }).fill(ENGLISH);
	await page.getByRole("button", { name: "Start" }).click();
	await page.getByRole("button", { name: "Pause" }).click();
	await page.getByRole("button", { name: /Back one paragraph/ }).click();
	await page
		.getByRole("group", { name: "Reading Mode" })
		.getByRole("button", { name: "Listen" })
		.click();
	await expect(pane(page)).toBeVisible();
}

async function download(page: Page) {
	await page.getByRole("button", { name: "Download 37.3 MB" }).click();
	await expect(voiceSelect(page)).toHaveValue(KOKORO_URI);
}

test.describe("Listen on the on-device voice", () => {
	test("offers the download, and asks no host and starts no worker before the reader agrees", async ({
		page,
	}) => {
		await stubSpeech(page);
		const requests = watchVoiceRequests(page);
		await openListen(page);
		const row = page.getByTestId("listen-device");
		await expect(row).toContainText("On-device voice");
		await expect(row).toContainText(
			"downloads 37.3 MB once from Hugging Face, then works offline",
		);
		await expect(
			page.getByRole("button", { name: "Download 37.3 MB" }),
		).toBeVisible();
		await expect(voiceSelect(page).locator("option")).not.toContainText([
			"Speeedy voice (on this device)",
		]);
		await page.getByRole("button", { name: "Play" }).click();
		await expect.poll(() => nowText(page)).not.toBe("");
		expect(requests).toEqual([]);
	});

	test("downloads with the reader's consent, then reads with it, the highlight following the audio", async ({
		page,
	}) => {
		await stubSpeech(page);
		await serveWorker(page, "ok");
		await openListen(page);
		await page.getByRole("button", { name: "Download 37.3 MB" }).click();
		await expect(page.getByRole("progressbar")).toBeVisible();
		await expect(page.getByTestId("listen-device")).toContainText(
			"Downloading 12.0 MB of 37.3 MB",
		);
		await expect(voiceSelect(page)).toHaveValue(KOKORO_URI);
		await expect(page.getByTestId("listen-device")).toHaveCount(0);
		await page.getByRole("button", { name: "Play" }).click();
		const seen = new Set<string>();
		await expect
			.poll(
				async () => {
					const text = await nowText(page);
					if (text) seen.add(text);
					return seen.size;
				},
				{ timeout: 10_000, intervals: [50] },
			)
			.toBeGreaterThanOrEqual(4);
		// The on-device voice spoke: the browser's voice was never asked.
		expect(
			await page.evaluate(
				() => (window as unknown as { __spoken: string[] }).__spoken,
			),
		).toEqual([]);
		await page.getByRole("button", { name: "Pause" }).click();
		const paused = await nowText(page);
		await page.waitForTimeout(700);
		expect(await nowText(page)).toBe(paused);
	});

	test("gives way to the browser's voice with a plain line when it fails", async ({
		page,
	}) => {
		await stubSpeech(page);
		await serveWorker(page, "fail");
		await openListen(page);
		await download(page);
		await page.getByRole("button", { name: "Play" }).click();
		await expect(page.getByTestId("listen-device-note")).toHaveText(
			"The on-device voice stopped, so the browser voice reads instead. Choose it again to retry.",
		);
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { __spoken: string[] }).__spoken.length,
				),
			)
			.toBeGreaterThan(0);
		await expect(voiceSelect(page)).not.toHaveValue(KOKORO_URI);
	});

	for (const viewport of [
		{ name: "390px", width: 390, height: 844 },
		{ name: "desktop", width: 1280, height: 800 },
	]) {
		test(`axe passes with the download offered and after it, at ${viewport.name}, and it fits`, async ({
			page,
		}) => {
			await stubSpeech(page);
			await serveWorker(page, "ok");
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});
			await openListen(page);
			await expect(page.getByTestId("listen-device")).toBeVisible();
			await page.evaluate(() => document.fonts.ready);
			const axe = () =>
				new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
					.analyze();
			expect((await axe()).violations).toEqual([]);
			const fits = () =>
				page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				);
			expect(await fits()).toBe(true);
			await download(page);
			expect((await axe()).violations).toEqual([]);
			expect(await fits()).toBe(true);
		});
	}
});
