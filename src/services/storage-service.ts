import { type IDBPDatabase, openDB } from "idb";
import type { SavedDocument, UserProfile } from "../models/types.js";
import { DEFAULT_SETTINGS, getDefaultFontSize } from "./defaults.js";

const DB_NAME = "speeedy-db";
const DB_VERSION = 2;
const PROFILE_STORE = "profile";
const PROFILE_KEY = "user-profile";
const DOCS_STORE = "documents";

const MAX_SAVED_DOCS = 20;

let dbInstance: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
	if (dbInstance) return dbInstance;
	dbInstance = await openDB(DB_NAME, DB_VERSION, {
		upgrade(db, oldVersion) {
			try {
				if (!db.objectStoreNames.contains(PROFILE_STORE)) {
					db.createObjectStore(PROFILE_STORE);
				}
				if (oldVersion < 2 && !db.objectStoreNames.contains(DOCS_STORE)) {
					db.createObjectStore(DOCS_STORE, { keyPath: "id" });
				}
			} catch (err) {
				console.error("[speeedy] IndexedDB upgrade failed:", err);
			}
		},
		blocked() {
			// Another tab holds an older DB version — the upgrade can't proceed until it closes.
			console.warn("[speeedy] Database upgrade blocked by another tab.");
		},
		blocking() {
			// This tab holds an old version and a newer tab needs to upgrade.
			// Close our connection so the other tab can proceed.
			dbInstance?.close();
			dbInstance = null;
		},
	});
	return dbInstance;
}

function createDefaultProfile(): UserProfile {
	return {
		id: crypto.randomUUID(),
		displayName: "Reader",
		avatarEmoji: "📚",
		avatarImage: null,
		createdAt: new Date().toISOString(),
		goals: { type: "words", target: 10000 },
		totalWordsRead: 0,
		totalTimeMs: 0,
		currentStreak: 0,
		bestStreak: 0,
		lastReadDate: null,
		sessions: [],
		settings: { ...DEFAULT_SETTINGS, fontSize: getDefaultFontSize() },
		baselineWpm: null,
		baselineComprehension: null,
		onboardingSeen: false,
	};
}

export async function loadProfile(): Promise<UserProfile> {
	const db = await getDb();
	const profile = await db.get(PROFILE_STORE, PROFILE_KEY);
	if (profile) return profile as UserProfile;
	const newProfile = createDefaultProfile();
	await db.put(PROFILE_STORE, newProfile, PROFILE_KEY);
	return newProfile;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
	const db = await getDb();
	await db.put(PROFILE_STORE, profile, PROFILE_KEY);
}

export async function exportProfile(): Promise<string> {
	const profile = await loadProfile();
	const json = JSON.stringify(profile);
	const bytes = new TextEncoder().encode(json);
	const compressed = await compressData(bytes);
	const arr = new Uint8Array(compressed);
	let binary = "";
	for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
	return btoa(binary);
}

export async function importProfile(encoded: string): Promise<UserProfile> {
	const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
	const decompressed = await decompressData(bytes);
	const json = new TextDecoder().decode(decompressed);
	const raw = JSON.parse(json);
	if (!isValidProfile(raw)) throw new Error("Invalid profile data.");
	const defaults = createDefaultProfile();
	const merged: UserProfile = {
		...defaults,
		...raw,
		settings: { ...DEFAULT_SETTINGS, ...raw.settings },
	};
	await saveProfile(merged);
	return merged;
}

function isValidProfile(obj: unknown): obj is UserProfile {
	if (!obj || typeof obj !== "object") return false;
	const p = obj as Record<string, unknown>;
	return (
		typeof p.id === "string" &&
		typeof p.displayName === "string" &&
		Array.isArray(p.sessions) &&
		typeof p.settings === "object" &&
		p.settings !== null
	);
}

async function compressData(data: Uint8Array): Promise<ArrayBuffer> {
	const stream = new CompressionStream("gzip");
	const writer = stream.writable.getWriter();
	await writer.write(data.buffer.slice(0) as ArrayBuffer);
	await writer.close();
	return new Response(stream.readable).arrayBuffer();
}

async function decompressData(data: Uint8Array): Promise<ArrayBuffer> {
	const stream = new DecompressionStream("gzip");
	const writer = stream.writable.getWriter();
	await writer.write(data.buffer.slice(0) as ArrayBuffer);
	await writer.close();
	return new Response(stream.readable).arrayBuffer();
}

export async function getSavedDocuments(): Promise<SavedDocument[]> {
	const db = await getDb();
	const docs = (await db.getAll(DOCS_STORE)) as SavedDocument[];
	return docs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

async function hashContent(text: string): Promise<string> {
	const buf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function saveDocument(
	doc: Omit<SavedDocument, "id" | "savedAt">,
): Promise<SavedDocument> {
	const db = await getDb();
	const contentHash = await hashContent(doc.text);
	const all = (await db.getAll(DOCS_STORE)) as SavedDocument[];

	for (const existing of all) {
		const existingHash =
			existing.contentHash ?? (await hashContent(existing.text));
		if (existingHash === contentHash) {
			const updated: SavedDocument = {
				...existing,
				savedAt: new Date().toISOString(),
			};
			await db.put(DOCS_STORE, updated);
			return updated;
		}
	}

	const saved: SavedDocument = {
		...doc,
		id: crypto.randomUUID(),
		savedAt: new Date().toISOString(),
		contentHash,
	};
	await db.put(DOCS_STORE, saved);
	await pruneDocuments(db);
	return saved;
}

export async function updateDocumentProgress(
	id: string,
	resumeWordIndex: number,
	completionPercent: number,
): Promise<void> {
	const db = await getDb();
	const doc = (await db.get(DOCS_STORE, id)) as SavedDocument | undefined;
	if (!doc) return;
	await db.put(DOCS_STORE, { ...doc, resumeWordIndex, completionPercent });
}

export async function deleteSavedDocument(id: string): Promise<void> {
	const db = await getDb();
	await db.delete(DOCS_STORE, id);
}

async function pruneDocuments(db: IDBPDatabase): Promise<void> {
	const all = ((await db.getAll(DOCS_STORE)) as SavedDocument[]).sort((a, b) =>
		b.savedAt.localeCompare(a.savedAt),
	);
	if (all.length > MAX_SAVED_DOCS) {
		const toDelete = all.slice(MAX_SAVED_DOCS);
		for (const doc of toDelete) {
			await db.delete(DOCS_STORE, doc.id);
		}
	}
}
