import { expect } from "vitest";
import {
	applyPush,
	type DeviceDocument,
	type DeviceState,
	type LocalWrite,
	type ServerState,
	type SyncDocument,
	type SyncInput,
	type SyncResult,
	type SyncSession,
	syncDevice,
} from "../src/index.ts";

export const NOW = 50_000;

export const deviceDoc = (
	id: string,
	overrides: Partial<DeviceDocument> = {},
): DeviceDocument => ({
	id,
	contentHash: `hash-${id}`,
	language: "en",
	title: `Title ${id}`,
	titleChangedAt: 0,
	languageOverride: null,
	languageOverrideChangedAt: 0,
	position: { block: 0, offset: 0 },
	progress: 0,
	positionChangedAt: 0,
	deviceOnly: false,
	deviceOnlyChangedAt: 0,
	...overrides,
});

export const serverDoc = (
	id: string,
	overrides: Partial<SyncDocument> = {},
): SyncDocument => syncFields(deviceDoc(id, overrides));

export const session = (
	id: string,
	overrides: Partial<SyncSession> = {},
): SyncSession => ({
	id,
	documentId: null,
	date: "2026-11-01",
	startedAt: 1_000,
	activeMs: 60_000,
	wordsRead: 200,
	wpm: 200,
	...overrides,
});

export const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
	generation: "g1",
	documents: [],
	tombstones: [],
	settings: {},
	dailyGoalChanges: [],
	sessions: [],
	trainingResults: [],
	...overrides,
});

export const server = (overrides: Partial<ServerState> = {}): ServerState => ({
	generation: "g1",
	documents: [],
	tombstones: [],
	settings: {},
	dailyGoalChanges: [],
	sessions: [],
	trainingResults: [],
	...overrides,
});

export function syncFields(doc: SyncDocument): SyncDocument {
	return {
		id: doc.id,
		contentHash: doc.contentHash,
		language: doc.language,
		title: doc.title,
		titleChangedAt: doc.titleChangedAt,
		languageOverride: doc.languageOverride,
		languageOverrideChangedAt: doc.languageOverrideChangedAt,
		position: doc.position,
		progress: doc.progress,
		positionChangedAt: doc.positionChangedAt,
	};
}

const byId = <T extends { id: string }>(records: readonly T[]): T[] =>
	[...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Sort every list, so two states compare by content. */
export function normalise<S extends DeviceState | ServerState>(state: S): S {
	return {
		...state,
		documents: byId(state.documents as SyncDocument[]),
		tombstones: byId(state.tombstones),
		sessions: byId(state.sessions),
		dailyGoalChanges: byId(state.dailyGoalChanges),
		trainingResults: byId(state.trainingResults),
	};
}

const upsert = <T extends { id: string }>(records: T[], record: T): T[] => [
	...records.filter((each) => each.id !== record.id),
	record,
];

/**
 * What a Library does with each write, written apart from the package, so a test can check
 * that the writes alone bring the device to the merged state.
 */
export function applyWrites(
	state: DeviceState,
	writes: readonly LocalWrite[],
	generation: string,
): DeviceState {
	let next: DeviceState = { ...state, generation };
	const docs = (change: (docs: DeviceDocument[]) => DeviceDocument[]) => {
		next = { ...next, documents: change(next.documents) };
	};
	for (const write of writes) {
		switch (write.kind) {
			case "add-document":
				docs((all) => [
					...all,
					{ ...write.document, deviceOnly: false, deviceOnlyChangedAt: 0 },
				]);
				break;
			case "update-document":
				docs((all) =>
					all.map((doc) =>
						doc.id === write.document.id ? { ...doc, ...write.document } : doc,
					),
				);
				break;
			case "rekey-document":
				docs((all) =>
					all.map((doc) =>
						doc.id === write.from ? { ...doc, id: write.to } : doc,
					),
				);
				break;
			case "remove-document":
				docs((all) => all.filter((doc) => doc.id !== write.id));
				break;
			case "set-device-only":
				docs((all) =>
					all.map((doc) =>
						doc.id === write.id
							? { ...doc, deviceOnly: true, deviceOnlyChangedAt: write.at }
							: doc,
					),
				);
				break;
			case "drop-tombstone":
				next = {
					...next,
					tombstones: next.tombstones.filter((each) => each.id !== write.id),
				};
				break;
			case "put-session":
				next = { ...next, sessions: upsert(next.sessions, write.session) };
				break;
			case "put-setting":
				next = {
					...next,
					settings: { ...next.settings, [write.key]: write.entry },
				};
				break;
			case "put-goal-change":
				next = {
					...next,
					dailyGoalChanges: upsert(next.dailyGoalChanges, write.change),
				};
				break;
			case "put-training-result":
				next = {
					...next,
					trainingResults: upsert(next.trainingResults, write.result),
				};
				break;
		}
	}
	return next;
}

export type Synced = Extract<SyncResult, { status: "synced" }>;

export const counter = (prefix: string) => {
	let n = 0;
	return () => `${prefix}${++n}`;
};

/**
 * Run one sync and check its two promises: the writes bring the device to `device`, and the
 * server's own merge of `push` gives `server`.
 */
export function run(
	input: Partial<SyncInput> & Pick<SyncInput, "device" | "server">,
): SyncResult {
	const result = syncDevice({ now: NOW, newId: counter("new-"), ...input });
	if (result.status === "synced") {
		expect(
			normalise(applyWrites(input.device, result.writes, result.generation)),
		).toEqual(normalise(result.device));
		expect(normalise(applyPush(input.server, result.push).server)).toEqual(
			normalise(result.server),
		);
	}
	return result;
}

export function synced(
	input: Partial<SyncInput> & Pick<SyncInput, "device" | "server">,
): Synced {
	const result = run(input);
	if (result.status !== "synced") {
		throw new Error(`expected a sync, got ${JSON.stringify(result)}`);
	}
	return result;
}

export const docIn = (
	state: { documents: readonly SyncDocument[] },
	id: string,
): SyncDocument | undefined => state.documents.find((doc) => doc.id === id);

export const writesOf = <K extends LocalWrite["kind"]>(
	result: Synced,
	kind: K,
): Extract<LocalWrite, { kind: K }>[] =>
	result.writes.filter(
		(write): write is Extract<LocalWrite, { kind: K }> => write.kind === kind,
	);
