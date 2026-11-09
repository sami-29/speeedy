import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Clip, ClipWord } from "./clip.ts";

/** What the on-device voice may keep of its audio, across every document, voice and speed. */
export const AUDIO_CACHE_BYTES = 500_000_000;

/** The database the voice's audio is kept in. */
export const AUDIO_CACHE_NAME = "speeedy-voice-audio";

/**
 * Sentences' audio, kept so a sentence heard again (a rewind, a second read) plays at once.
 * Only the samples count toward the cap; when a new clip would go over it, the clips played
 * longest ago go first. A clip bigger than the whole cap is not kept.
 */
export type AudioCache = {
	get(key: string): Promise<Clip | undefined>;
	put(key: string, clip: Clip): Promise<void>;
	/** Bytes of audio kept. */
	size(): Promise<number>;
};

type CacheOptions = {
	cap?: number;
	/** When a clip was last played, for dropping the oldest. Defaults to `Date.now`. */
	now?: () => number;
};

const bytesOf = (clip: Clip) => clip.samples.byteLength;

/** The audio cache in memory: for tests, and for a browser without IndexedDB. */
export function memoryAudioCache(options: CacheOptions = {}): AudioCache {
	const cap = options.cap ?? AUDIO_CACHE_BYTES;
	const now = options.now ?? Date.now;
	const kept = new Map<string, { clip: Clip; used: number }>();
	let total = 0;
	return {
		async get(key) {
			const found = kept.get(key);
			if (!found) return undefined;
			found.used = now();
			return found.clip;
		},
		async put(key, clip) {
			const bytes = bytesOf(clip);
			if (bytes > cap) return;
			const old = kept.get(key);
			if (old) {
				total -= bytesOf(old.clip);
				kept.delete(key);
			}
			const oldest = [...kept.entries()].sort((a, b) => a[1].used - b[1].used);
			for (const [name, entry] of oldest) {
				if (total + bytes <= cap) break;
				total -= bytesOf(entry.clip);
				kept.delete(name);
			}
			kept.set(key, { clip, used: now() });
			total += bytes;
		},
		async size() {
			return total;
		},
	};
}

interface AudioSchema extends DBSchema {
	/** The audio itself, read only when played. */
	clips: {
		key: string;
		value: {
			key: string;
			samples: Float32Array;
			sampleRate: number;
			words: ClipWord[];
		};
	};
	/** Each clip's size and when it was last played, small enough to scan on every put. */
	meta: {
		key: string;
		value: { key: string; bytes: number; used: number };
		indexes: { byUsed: number };
	};
}

/** The audio cache in IndexedDB, shared by every tab and document. Never throws. */
export function createAudioCache(
	options: CacheOptions & { name?: string } = {},
): AudioCache {
	const cap = options.cap ?? AUDIO_CACHE_BYTES;
	const now = options.now ?? Date.now;
	let opened: Promise<IDBPDatabase<AudioSchema> | undefined> | undefined;
	const db = () => {
		opened ??= openDB<AudioSchema>(options.name ?? AUDIO_CACHE_NAME, 1, {
			upgrade(upgrading) {
				upgrading.createObjectStore("clips", { keyPath: "key" });
				upgrading
					.createObjectStore("meta", { keyPath: "key" })
					.createIndex("byUsed", "used");
			},
		}).catch(() => undefined);
		return opened;
	};

	return {
		async get(key) {
			try {
				const database = await db();
				if (!database) return undefined;
				const tx = database.transaction(["clips", "meta"], "readwrite");
				const [clip, meta] = await Promise.all([
					tx.objectStore("clips").get(key),
					tx.objectStore("meta").get(key),
				]);
				if (!clip || !meta) {
					await tx.done;
					return undefined;
				}
				await tx.objectStore("meta").put({ ...meta, used: now() });
				await tx.done;
				return {
					samples: clip.samples,
					sampleRate: clip.sampleRate,
					words: clip.words,
				};
			} catch {
				return undefined;
			}
		},
		async put(key, clip) {
			const bytes = bytesOf(clip);
			if (bytes > cap) return;
			try {
				const database = await db();
				if (!database) return;
				const tx = database.transaction(["clips", "meta"], "readwrite");
				const meta = tx.objectStore("meta");
				const clips = tx.objectStore("clips");
				let total = 0;
				for (const entry of await meta.getAll()) {
					if (entry.key !== key) total += entry.bytes;
				}
				let cursor = await meta.index("byUsed").openCursor();
				while (cursor && total + bytes > cap) {
					if (cursor.value.key !== key) {
						total -= cursor.value.bytes;
						await clips.delete(cursor.value.key);
						await cursor.delete();
					}
					cursor = await cursor.continue();
				}
				await clips.put({
					key,
					samples: clip.samples,
					sampleRate: clip.sampleRate,
					words: clip.words,
				});
				await meta.put({ key, bytes, used: now() });
				await tx.done;
			} catch {
				// Out of quota or private browsing: the sentence is made again next time.
			}
		},
		async size() {
			try {
				const database = await db();
				if (!database) return 0;
				const all = await database.getAll("meta");
				return all.reduce((sum, entry) => sum + entry.bytes, 0);
			} catch {
				return 0;
			}
		},
	};
}
