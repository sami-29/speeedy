import {
	canonicalJson,
	mergeDocument,
	mergeInsertOnce,
	mergeSession,
	mergeSessions,
	mergeSettings,
	mergeTombstone,
	mergeTombstones,
} from "./merge.ts";
import type {
	DeviceDocument,
	DeviceState,
	LocalWrite,
	Push,
	Refusal,
	ServerState,
	SettingEntry,
	SyncDocument,
	SyncInput,
	SyncResult,
	SyncSession,
	SyncTombstone,
} from "./types.ts";

/** The settings that sync. Every other key stays on the device. */
export const SYNCED_SETTINGS: readonly string[] = ["libraryLineHidden"];

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byId = <T extends { id: string }>(records: Iterable<T>): T[] =>
	[...records].sort((a, b) => compareIds(a.id, b.id));

/** Only the fields that sync. Whatever else the device keeps, such as the source URL, stays. */
function syncFields(doc: SyncDocument): SyncDocument {
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

/** What becomes of one document on this device. */
type Plan =
	| { kind: "device-only" }
	| { kind: "removed" }
	| { kind: "merge"; with: SyncDocument }
	| { kind: "rekey"; to: SyncDocument }
	| { kind: "unmatched"; again: boolean };

/**
 * One sync of one device with the server: the device's records and the server's in, the
 * writes for the device and the push for the server out. The device applies `writes` once
 * the server accepts `push`; `device` and `server` are the states both then hold.
 */
export function syncDevice(input: SyncInput): SyncResult {
	const { device, server, now } = input;
	const syncedKeys = new Set(input.syncedSettings ?? SYNCED_SETTINGS);
	const firstSync = device.generation !== server.generation;
	const serverLive = new Map(server.documents.map((doc) => [doc.id, doc]));
	const serverDead = new Map(server.tombstones.map((each) => [each.id, each]));
	const known = (id: string) => serverLive.has(id) || serverDead.has(id);

	// Deletes made here. One the server never knew about says nothing to it.
	const deletes = new Map<string, SyncTombstone>();
	for (const local of byId(device.tombstones)) {
		if (!known(local.id)) continue;
		const held = serverDead.get(local.id);
		if (held === undefined || !same(mergeTombstone(held, local), held)) {
			deletes.set(local.id, local);
		}
	}
	// Keep on this device only acts as a delete everywhere else.
	for (const doc of byId(device.documents)) {
		if (doc.deviceOnly && serverLive.has(doc.id) && !deletes.has(doc.id)) {
			deletes.set(doc.id, {
				id: doc.id,
				contentHash: doc.contentHash,
				deletedAt: doc.deviceOnlyChangedAt,
			});
		}
	}
	const live = byId(server.documents).filter((doc) => !deletes.has(doc.id));
	const twinOf = new Map<string, SyncDocument>();
	for (const doc of live) {
		if (!twinOf.has(doc.contentHash)) twinOf.set(doc.contentHash, doc);
	}

	const localDocs = byId(device.documents);
	const claimed = new Set<string>();
	const plans = new Map<string, Plan>();
	const claimTwin = (doc: DeviceDocument): SyncDocument | undefined => {
		const twin = twinOf.get(doc.contentHash);
		if (twin === undefined || claimed.has(twin.id)) return undefined;
		claimed.add(twin.id);
		return twin;
	};
	for (const doc of localDocs) {
		if (doc.deviceOnly) {
			plans.set(doc.id, { kind: "device-only" });
			continue;
		}
		const dead = serverDead.get(doc.id);
		if (dead !== undefined) {
			// A delete beats the document, unless "Keep on this device only" was turned off later.
			if (doc.deviceOnlyChangedAt <= dead.deletedAt) {
				plans.set(doc.id, { kind: "removed" });
				continue;
			}
			const twin = claimTwin(doc);
			plans.set(
				doc.id,
				twin ? { kind: "rekey", to: twin } : { kind: "unmatched", again: true },
			);
			continue;
		}
		const held = deletes.has(doc.id) ? undefined : serverLive.get(doc.id);
		if (held !== undefined) {
			claimed.add(held.id);
			plans.set(doc.id, { kind: "merge", with: held });
			continue;
		}
		const twin = claimTwin(doc);
		plans.set(
			doc.id,
			twin ? { kind: "rekey", to: twin } : { kind: "unmatched", again: false },
		);
	}

	const unmatched = localDocs.filter(
		(doc) => plans.get(doc.id)?.kind === "unmatched",
	);
	const asks = firstSync && live.length > 0 && unmatched.length > 0;
	if (asks && input.firstSyncAnswer === undefined) {
		return { status: "question", documents: unmatched.length };
	}
	const keep = asks && input.firstSyncAnswer === "keep";

	const writes: LocalWrite[] = [];
	const pushed = new Map<string, SyncDocument>();
	const uploads: string[] = [];
	const rekeyed = new Map<string, string>();
	const deviceOnlyAfter = new Set<string>();
	const textsHere = new Set<string>();

	const settle = (local: SyncDocument, account: SyncDocument | undefined) => {
		const merged = account ? mergeDocument(local, account) : local;
		if (!same(merged, local))
			writes.push({ kind: "update-document", document: merged });
		if (account === undefined || !same(merged, account))
			pushed.set(merged.id, merged);
	};

	for (const doc of localDocs) {
		const plan = plans.get(doc.id) as Plan;
		const fields = syncFields(doc);
		switch (plan.kind) {
			case "device-only":
				deviceOnlyAfter.add(doc.id);
				textsHere.add(doc.contentHash);
				break;
			case "removed":
				writes.push({ kind: "remove-document", id: doc.id });
				break;
			case "merge":
				textsHere.add(doc.contentHash);
				settle(fields, plan.with);
				break;
			case "rekey":
				textsHere.add(doc.contentHash);
				writes.push({ kind: "rekey-document", from: doc.id, to: plan.to.id });
				rekeyed.set(doc.id, plan.to.id);
				settle({ ...fields, id: plan.to.id }, plan.to);
				break;
			case "unmatched":
				textsHere.add(doc.contentHash);
				if (keep) {
					writes.push({ kind: "set-device-only", id: doc.id, at: now });
					deviceOnlyAfter.add(doc.id);
					break;
				}
				if (plan.again) {
					const fresh = input.newId();
					writes.push({ kind: "rekey-document", from: doc.id, to: fresh });
					rekeyed.set(doc.id, fresh);
					settle({ ...fields, id: fresh }, undefined);
					uploads.push(fresh);
				} else {
					settle(fields, undefined);
					uploads.push(doc.id);
				}
				break;
		}
	}

	// Documents from the account, unless this device holds the same text (device-only, say).
	const local = new Set(localDocs.map((doc) => doc.id));
	const downloads = live
		.filter(
			(doc) =>
				!local.has(doc.id) &&
				!claimed.has(doc.id) &&
				!textsHere.has(doc.contentHash),
		)
		.sort(
			(a, b) =>
				b.positionChangedAt - a.positionChangedAt || compareIds(a.id, b.id),
		);
	for (const doc of downloads)
		writes.push({ kind: "add-document", document: doc });

	// Sessions. One about a document the account doesn't hold, or holds only on this device,
	// stays here.
	const knownAfter = new Set([
		...live.map((doc) => doc.id),
		...pushed.keys(),
		...serverDead.keys(),
		...deletes.keys(),
	]);
	const shareable = (session: SyncSession) =>
		session.documentId === null ||
		(!deviceOnlyAfter.has(session.documentId) &&
			knownAfter.has(session.documentId));
	const serverSessions = new Map(
		server.sessions.map((each) => [each.id, each]),
	);
	const pushedSessions: SyncSession[] = [];
	for (const mine of byId(device.sessions)) {
		const held = serverSessions.get(mine.id);
		const movedTo =
			mine.documentId === null ? undefined : rekeyed.get(mine.documentId);
		const moved =
			held === undefined && movedTo !== undefined
				? { ...mine, documentId: movedTo }
				: mine;
		const merged = held ? mergeSession(moved, held) : moved;
		if (!same(merged, mine))
			writes.push({ kind: "put-session", session: merged });
		if ((held === undefined || !same(merged, held)) && shareable(merged)) {
			pushedSessions.push(merged);
		}
	}
	const localSessions = new Set(device.sessions.map((each) => each.id));
	for (const theirs of byId(server.sessions)) {
		if (!localSessions.has(theirs.id))
			writes.push({ kind: "put-session", session: theirs });
	}

	// Settings, one key at a time.
	const pushedSettings: Record<string, SettingEntry> = {};
	const syncedOnly = (all: Record<string, SettingEntry>) =>
		Object.fromEntries(
			Object.entries(all).filter(([key]) => syncedKeys.has(key)),
		);
	const mySettings = syncedOnly(device.settings);
	const theirSettings = syncedOnly(server.settings);
	for (const [key, entry] of Object.entries(
		mergeSettings(mySettings, theirSettings),
	)) {
		if (!same(entry, mySettings[key]))
			writes.push({ kind: "put-setting", key, entry });
		if (!same(entry, theirSettings[key])) {
			Object.defineProperty(pushedSettings, key, {
				value: entry,
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
	}

	// Insert-once records: the account's copy is the one kept.
	const insertOnce = <T extends { id: string }>(
		mine: readonly T[],
		theirs: readonly T[],
		write: (record: T) => LocalWrite,
	): T[] => {
		const held = new Map(theirs.map((each) => [each.id, each]));
		const kept = new Map(mine.map((each) => [each.id, each]));
		for (const record of mergeInsertOnce(theirs, mine)) {
			if (!same(record, kept.get(record.id))) writes.push(write(record));
		}
		return byId(mine.filter((each) => !held.has(each.id)));
	};
	const pushedGoals = insertOnce(
		device.dailyGoalChanges,
		server.dailyGoalChanges,
		(change) => ({
			kind: "put-goal-change",
			change,
		}),
	);
	const pushedResults = insertOnce(
		device.trainingResults,
		server.trainingResults,
		(result) => ({
			kind: "put-training-result",
			result,
		}),
	);

	for (const local of byId(device.tombstones)) {
		writes.push({ kind: "drop-tombstone", id: local.id });
	}

	const push: Push = {
		documents: byId(pushed.values()),
		uploads: uploads.sort(compareIds),
		tombstones: byId(deletes.values()),
		sessions: pushedSessions,
		settings: pushedSettings,
		dailyGoalChanges: pushedGoals,
		trainingResults: pushedResults,
	};
	return {
		status: "synced",
		generation: server.generation,
		device: applyWrites(device, writes, server.generation),
		server: applyPush(server, push).server,
		writes,
		push,
		downloads: downloads.map((doc) => doc.id),
	};
}

/** The device's state once `writes` are applied in order. */
function applyWrites(
	state: DeviceState,
	writes: readonly LocalWrite[],
	generation: string,
): DeviceState {
	let documents = [...state.documents];
	let tombstones = [...state.tombstones];
	const sessions = new Map(state.sessions.map((each) => [each.id, each]));
	const settings = { ...state.settings };
	const goals = new Map(state.dailyGoalChanges.map((each) => [each.id, each]));
	const results = new Map(state.trainingResults.map((each) => [each.id, each]));
	const edit = (
		id: string,
		change: (doc: DeviceDocument) => DeviceDocument,
	) => {
		documents = documents.map((doc) => (doc.id === id ? change(doc) : doc));
	};
	for (const write of writes) {
		switch (write.kind) {
			case "add-document":
				documents.push({
					...write.document,
					deviceOnly: false,
					deviceOnlyChangedAt: 0,
				});
				break;
			case "update-document":
				edit(write.document.id, (doc) => ({ ...doc, ...write.document }));
				break;
			case "rekey-document":
				edit(write.from, (doc) => ({ ...doc, id: write.to }));
				break;
			case "remove-document":
				documents = documents.filter((doc) => doc.id !== write.id);
				break;
			case "set-device-only":
				edit(write.id, (doc) => ({
					...doc,
					deviceOnly: true,
					deviceOnlyChangedAt: write.at,
				}));
				break;
			case "drop-tombstone":
				tombstones = tombstones.filter((each) => each.id !== write.id);
				break;
			case "put-session":
				sessions.set(write.session.id, write.session);
				break;
			case "put-setting":
				Object.defineProperty(settings, write.key, {
					value: write.entry,
					enumerable: true,
					writable: true,
					configurable: true,
				});
				break;
			case "put-goal-change":
				goals.set(write.change.id, write.change);
				break;
			case "put-training-result":
				results.set(write.result.id, write.result);
				break;
		}
	}
	return {
		generation,
		documents,
		tombstones,
		settings,
		sessions: [...sessions.values()],
		dailyGoalChanges: [...goals.values()],
		trainingResults: [...results.values()],
	};
}

/**
 * The server's side of a sync: merge one device's push into the Account. A tombstone beats
 * the live document, and a new document whose text the Account already holds under another
 * ID is refused, so the Account keeps one copy of each text.
 */
export function applyPush(
	server: ServerState,
	push: Push,
): { server: ServerState; refused: Refusal[] } {
	const tombstones = mergeTombstones(server.tombstones, push.tombstones);
	const dead = new Set(tombstones.map((each) => each.id));
	const live = new Map(
		server.documents
			.filter((doc) => !dead.has(doc.id))
			.map((doc) => [doc.id, doc]),
	);
	const refused: Refusal[] = [];
	for (const doc of byId(push.documents)) {
		if (dead.has(doc.id)) continue;
		const held = live.get(doc.id);
		if (held !== undefined) {
			live.set(doc.id, mergeDocument(held, syncFields(doc)));
			continue;
		}
		const twin = [...live.values()].find(
			(each) => each.contentHash === doc.contentHash,
		);
		if (twin !== undefined) {
			refused.push({ id: doc.id, existingId: twin.id });
			continue;
		}
		live.set(doc.id, syncFields(doc));
	}
	return {
		server: {
			generation: server.generation,
			documents: byId(live.values()),
			tombstones,
			sessions: mergeSessions(server.sessions, push.sessions),
			settings: mergeSettings(server.settings, push.settings),
			dailyGoalChanges: mergeInsertOnce(
				server.dailyGoalChanges,
				push.dailyGoalChanges,
			),
			trainingResults: mergeInsertOnce(
				server.trainingResults,
				push.trainingResults,
			),
		},
		refused,
	};
}
