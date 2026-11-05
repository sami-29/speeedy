import { type CacheLike, KOKORO_ASSETS } from "@speeedy/kokoro";
import { describe, expect, it } from "vitest";
import { memoryAudioCache } from "../src/lib/voice/audio-cache.ts";
import { createOnDeviceVoice } from "../src/lib/voice/on-device.ts";
import { fakeKokoroWorker, settle } from "./fake-kokoro.ts";

/** The voice's Cache Storage cache as the page sees it, holding the given asset keys. */
function voiceCache(keys: readonly string[] = []) {
	const urls = new Set(keys.map((key) => `https://kokoro.invalid/${key}`));
	let opens = 0;
	const cache: CacheLike = {
		match: async () => undefined,
		put: async () => {},
		delete: async () => true,
		keys: async () => [...urls].map((url) => ({ url })),
	};
	return {
		open: async () => {
			opens++;
			return cache;
		},
		get opens() {
			return opens;
		},
	};
}

const ALL = Object.values(KOKORO_ASSETS).map((asset) => asset.key);

function voice(
	options: { cached?: readonly string[] } & Parameters<
		typeof fakeKokoroWorker
	>[0] = {},
) {
	const workers: ReturnType<typeof fakeKokoroWorker>[] = [];
	const cache = voiceCache(options.cached);
	const onDevice = createOnDeviceVoice({
		createWorker: () => {
			const made = fakeKokoroWorker(options);
			workers.push(made);
			return made.worker;
		},
		openCache: cache.open,
		audioCache: memoryAudioCache(),
	});
	return {
		onDevice,
		workers,
		cache,
		get worker() {
			return workers.at(-1);
		},
	};
}

describe("The on-device voice: before the reader agrees", () => {
	it("finds it is not downloaded without starting the worker or asking any host", async () => {
		const v = voice();
		expect(await v.onDevice.check()).toBe("absent");
		expect(v.onDevice.state.phase).toBe("absent");
		expect(v.workers).toEqual([]);
	});

	it("finds it is downloaded from the cache alone", async () => {
		const v = voice({ cached: ALL });
		expect(await v.onDevice.check()).toBe("downloaded");
		expect(v.workers).toEqual([]);
	});

	it("counts a download cut short as not downloaded", async () => {
		const v = voice({ cached: ALL.slice(0, 2) });
		expect(await v.onDevice.check()).toBe("absent");
	});

	it("shows the size it will download", () => {
		const v = voice();
		expect(v.onDevice.state.totalLabel).toBe("37.3 MB");
	});

	it("will not load or speak a voice that was never downloaded", async () => {
		const v = voice();
		await v.onDevice.check();
		expect(await v.onDevice.load()).toBe(false);
		await expect(v.onDevice.render("Hi there.", 1)).rejects.toMatchObject({
			code: "not-downloaded",
		});
		expect(v.workers).toEqual([]);
	});
});

describe("The on-device voice: downloading", () => {
	it("downloads only when asked, with the reader's consent, and shows how far it has got", async () => {
		const v = voice();
		await v.onDevice.check();
		const seen: string[] = [];
		v.onDevice.subscribe(() =>
			seen.push(`${v.onDevice.state.phase} ${v.onDevice.state.loaded}`),
		);
		const done = v.onDevice.download();
		expect(v.onDevice.state.phase).toBe("downloading");
		expect(await done).toBe(true);
		expect(v.worker?.requests).toContainEqual({
			type: "download",
			consent: true,
		});
		expect(seen).toContain("downloading 1000000");
		expect(v.onDevice.state.phase).toBe("ready");
	});

	it("says the download failed and lets the reader try again", async () => {
		const v = voice({ failDownload: true });
		await v.onDevice.check();
		expect(await v.onDevice.download()).toBe(false);
		expect(v.onDevice.state).toMatchObject({
			phase: "absent",
			error: "download",
		});
	});
});

describe("The on-device voice: speaking", () => {
	it("loads a downloaded voice the first time it speaks, and speaks from the cache after", async () => {
		const v = voice({ cached: ALL });
		await v.onDevice.check();
		const first = await v.onDevice.render("Hi there.", 1);
		expect(v.onDevice.state.phase).toBe("ready");
		expect(first.words).toHaveLength(2);
		expect(first.cached).toBe(false);
		const again = await v.onDevice.render("Hi there.", 1);
		expect(again.cached).toBe(true);
		expect(v.worker?.sentences).toEqual(["Hi there."]);
	});

	it("loads once however many sentences ask at the same time", async () => {
		const v = voice({ cached: ALL });
		await v.onDevice.check();
		await Promise.all([
			v.onDevice.render("One.", 1),
			v.onDevice.render("Two.", 1),
		]);
		expect(v.workers).toHaveLength(1);
		expect(v.worker?.requests.filter((r) => r.type === "load")).toHaveLength(1);
	});

	it("tells its listeners, and marks itself failed, when the worker dies", async () => {
		const v = voice({ cached: ALL });
		await v.onDevice.check();
		await v.onDevice.load();
		const failures: number[] = [];
		v.onDevice.onFailure(() => failures.push(1));
		v.worker?.crash();
		expect(failures).toEqual([1]);
		expect(v.onDevice.state.phase).toBe("failed");
		expect(v.workers[0]?.terminated).toBe(1);
	});

	it("starts a new worker when asked to load after a failure", async () => {
		const v = voice({ cached: ALL });
		await v.onDevice.check();
		await v.onDevice.load();
		v.worker?.crash();
		expect(await v.onDevice.load()).toBe(true);
		expect(v.workers).toHaveLength(2);
		expect(v.onDevice.state.phase).toBe("ready");
		await settle();
	});
});
