import { dailyGoalFor } from "@speeedy/engine";
import { describe, expect, it } from "vitest";
import {
	applyPush,
	type DeviceDocument,
	SYNCED_SETTINGS,
	type SyncDocument,
} from "../src/index.ts";
import {
	device,
	deviceDoc,
	docIn,
	NOW,
	run,
	server,
	serverDoc,
	session,
	synced,
	writesOf,
} from "./fixtures.ts";

const read = (block: number, at: number, progress = block / 10) => ({
	position: { block, offset: 0 },
	progress,
	positionChangedAt: at,
});

describe("Positions and renames: the latest local change wins", () => {
	it("takes the account's Position, with its progress, when it was read later", () => {
		const result = synced({
			device: device({ documents: [deviceDoc("a", read(2, 2_000))] }),
			server: server({ documents: [serverDoc("a", read(7, 3_000, 0.9))] }),
		});
		expect(writesOf(result, "update-document")).toEqual([
			{
				kind: "update-document",
				document: serverDoc("a", read(7, 3_000, 0.9)),
			},
		]);
		expect(result.push.documents).toEqual([]);
		expect(docIn(result.device, "a")).toMatchObject(read(7, 3_000, 0.9));
	});

	it("sends this device's Position when it was read later, even offline long ago", () => {
		const result = synced({
			device: device({ documents: [deviceDoc("a", read(5, 4_000))] }),
			server: server({ documents: [serverDoc("a", read(1, 3_000))] }),
		});
		expect(result.push.documents).toEqual([serverDoc("a", read(5, 4_000))]);
		expect(result.push.uploads).toEqual([]);
		expect(writesOf(result, "update-document")).toEqual([]);
		expect(docIn(result.server, "a")).toMatchObject(read(5, 4_000));
	});

	it("keeps a rename from one device and a read from another", () => {
		const result = synced({
			device: device({
				documents: [
					deviceDoc("a", {
						title: "Renamed here",
						titleChangedAt: 4_000,
						...read(1, 1_000),
					}),
				],
			}),
			server: server({ documents: [serverDoc("a", read(8, 5_000))] }),
		});
		const merged = serverDoc("a", {
			title: "Renamed here",
			titleChangedAt: 4_000,
			...read(8, 5_000),
		});
		expect(docIn(result.device, "a")).toMatchObject(merged);
		expect(docIn(result.server, "a")).toEqual(merged);
		expect(result.push.documents).toEqual([merged]);
	});

	it("keeps the later rename whichever side made it", () => {
		const old = { title: "Old", titleChangedAt: 1_000 };
		const later = { title: "Later", titleChangedAt: 2_000 };
		for (const [mine, theirs] of [
			[old, later],
			[later, old],
		]) {
			const result = synced({
				device: device({ documents: [deviceDoc("a", mine)] }),
				server: server({ documents: [serverDoc("a", theirs)] }),
			});
			expect(docIn(result.device, "a")?.title).toBe("Later");
			expect(docIn(result.server, "a")?.title).toBe("Later");
		}
	});

	it("settles equal times the same way on every device", () => {
		const alpha = { title: "Alpha", titleChangedAt: 3_000 };
		const beta = { title: "Beta", titleChangedAt: 3_000 };
		const one = synced({
			device: device({ documents: [deviceDoc("a", alpha)] }),
			server: server({ documents: [serverDoc("a", beta)] }),
		});
		const other = synced({
			device: device({ documents: [deviceDoc("a", beta)] }),
			server: server({ documents: [serverDoc("a", alpha)] }),
		});
		expect(docIn(one.server, "a")?.title).toBe("Beta");
		expect(docIn(other.server, "a")?.title).toBe("Beta");
	});

	it("never lets a never-read copy beat a real read", () => {
		const result = synced({
			device: device({ documents: [deviceDoc("a")] }),
			server: server({ documents: [serverDoc("a", read(6, 1))] }),
		});
		expect(docIn(result.device, "a")).toMatchObject(read(6, 1));
	});
});

describe("Sessions only grow", () => {
	it("unions Sessions by ID in both directions", () => {
		const result = synced({
			device: device({ sessions: [session("mine")] }),
			server: server({ sessions: [session("theirs")] }),
		});
		expect(result.push.sessions).toEqual([session("mine")]);
		expect(writesOf(result, "put-session")).toEqual([
			{ kind: "put-session", session: session("theirs") },
		]);
		expect(result.server.sessions.map((each) => each.id).sort()).toEqual([
			"mine",
			"theirs",
		]);
	});

	it("replaces a Session with a re-sent copy that shows more active time", () => {
		const longer = session("s", { activeMs: 90_000, wordsRead: 300 });
		const result = synced({
			device: device({ sessions: [longer] }),
			server: server({ sessions: [session("s")] }),
		});
		expect(result.push.sessions).toEqual([longer]);
		expect(result.server.sessions).toEqual([longer]);
	});

	it("never replaces a Session with a copy that shows less", () => {
		const shorter = session("s", { activeMs: 30_000 });
		const result = synced({
			device: device({ sessions: [shorter] }),
			server: server({ sessions: [session("s")] }),
		});
		expect(result.push.sessions).toEqual([]);
		expect(result.server.sessions).toEqual([session("s")]);
		expect(writesOf(result, "put-session")).toEqual([
			{ kind: "put-session", session: session("s") },
		]);
	});

	it("keeps the server's longer copy whatever a device pushes", () => {
		const push = {
			documents: [],
			uploads: [],
			tombstones: [],
			sessions: [session("s", { activeMs: 1 })],
			settings: {},
			dailyGoalChanges: [],
			trainingResults: [],
		};
		const after = applyPush(server({ sessions: [session("s")] }), push);
		expect(after.server.sessions).toEqual([session("s")]);
	});
});

describe("Training results and Daily Goal changes are insert-once", () => {
	const result = (id: string, score: number) => ({
		id,
		kind: "benchmark",
		completedAt: 1_000,
		scores: { wpm: score },
	});

	it("adds each side's new results to the other", () => {
		const outcome = synced({
			device: device({ trainingResults: [result("mine", 300)] }),
			server: server({ trainingResults: [result("theirs", 250)] }),
		});
		expect(outcome.push.trainingResults).toEqual([result("mine", 300)]);
		expect(writesOf(outcome, "put-training-result")).toEqual([
			{ kind: "put-training-result", result: result("theirs", 250) },
		]);
	});

	it("never replaces a record the account already holds", () => {
		const outcome = synced({
			device: device({ trainingResults: [result("r", 999)] }),
			server: server({ trainingResults: [result("r", 250)] }),
		});
		expect(outcome.push.trainingResults).toEqual([]);
		expect(outcome.server.trainingResults).toEqual([result("r", 250)]);
		expect(outcome.device.trainingResults).toEqual([result("r", 250)]);
	});

	it("keeps every goal change with its effective date, so the past is never rewritten", () => {
		const october = {
			id: "g-oct",
			minutes: 20,
			effectiveDate: "2026-10-01",
			changedAt: 1_000,
		};
		const november = {
			id: "g-nov",
			minutes: 30,
			effectiveDate: "2026-11-01",
			changedAt: 2_000,
		};
		const outcome = synced({
			device: device({ dailyGoalChanges: [october] }),
			server: server({ dailyGoalChanges: [november] }),
		});
		for (const state of [outcome.device, outcome.server]) {
			expect(state.dailyGoalChanges).toHaveLength(2);
			expect(dailyGoalFor(state.dailyGoalChanges, "2026-10-15")).toBe(20);
			expect(dailyGoalFor(state.dailyGoalChanges, "2026-11-02")).toBe(30);
		}
	});
});

describe("settings merge one at a time", () => {
	const syncedSettings = ["wpm", "chunkSize"];

	it("keeps a WPM change from the phone and a chunk change from the laptop", () => {
		const result = synced({
			syncedSettings,
			device: device({
				settings: {
					wpm: { value: 300, changedAt: 2_000 },
					chunkSize: { value: 1, changedAt: 1_000 },
				},
			}),
			server: server({
				settings: {
					wpm: { value: 250, changedAt: 1_000 },
					chunkSize: { value: 3, changedAt: 3_000 },
				},
			}),
		});
		const merged = {
			wpm: { value: 300, changedAt: 2_000 },
			chunkSize: { value: 3, changedAt: 3_000 },
		};
		expect(result.device.settings).toEqual(merged);
		expect(result.server.settings).toEqual(merged);
		expect(result.push.settings).toEqual({ wpm: merged.wpm });
		expect(writesOf(result, "put-setting")).toEqual([
			{ kind: "put-setting", key: "chunkSize", entry: merged.chunkSize },
		]);
	});

	it("settles equal change times the same way on both sides", () => {
		const low = { wpm: { value: 250, changedAt: 1_000 } };
		const high = { wpm: { value: 400, changedAt: 1_000 } };
		for (const [mine, theirs] of [
			[low, high],
			[high, low],
		]) {
			const result = synced({
				syncedSettings,
				device: device({ settings: mine }),
				server: server({ settings: theirs }),
			});
			expect(result.server.settings.wpm?.value).toBe(400);
		}
	});

	it("keeps device-only settings on the device and ignores keys that don't sync", () => {
		const result = synced({
			syncedSettings,
			device: device({ settings: { theme: { value: "dark", changedAt: 9 } } }),
			server: server({
				settings: { textSize: { value: 22, changedAt: 9 } },
			}),
		});
		expect(result.push.settings).toEqual({});
		expect(result.device.settings).toEqual({
			theme: { value: "dark", changedAt: 9 },
		});
		expect(writesOf(result, "put-setting")).toEqual([]);
	});

	it("syncs the Library line setting by default", () => {
		expect(SYNCED_SETTINGS).toContain("libraryLineHidden");
		const result = synced({
			device: device({
				settings: { libraryLineHidden: { value: true, changedAt: 5 } },
			}),
			server: server(),
		});
		expect(result.push.settings).toEqual({
			libraryLineHidden: { value: true, changedAt: 5 },
		});
	});
});

describe("tombstones beat live records", () => {
	it("removes a document deleted elsewhere, even one renamed here later, and keeps its Sessions", () => {
		const read = session("s", { documentId: "a" });
		const result = synced({
			device: device({
				documents: [deviceDoc("a", { title: "Late", titleChangedAt: 9_000 })],
				sessions: [read],
			}),
			server: server({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 5_000 }],
			}),
		});
		expect(writesOf(result, "remove-document")).toEqual([
			{ kind: "remove-document", id: "a" },
		]);
		expect(result.push.documents).toEqual([]);
		expect(result.device.documents).toEqual([]);
		expect(result.device.sessions).toEqual([read]);
		expect(result.push.sessions).toEqual([read]);
	});

	it("pushes a delete made here over a later change on the server, then drops it", () => {
		const result = synced({
			device: device({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 2_000 }],
			}),
			server: server({
				documents: [serverDoc("a", { title: "Late", titleChangedAt: 9_000 })],
			}),
		});
		expect(result.push.tombstones).toEqual([
			{ id: "a", contentHash: "hash-a", deletedAt: 2_000 },
		]);
		expect(result.server.documents).toEqual([]);
		expect(writesOf(result, "add-document")).toEqual([]);
		expect(writesOf(result, "drop-tombstone")).toEqual([
			{ kind: "drop-tombstone", id: "a" },
		]);
	});

	it("tells the server nothing about a delete of a document it never had", () => {
		const result = synced({
			device: device({
				tombstones: [
					{ id: "never", contentHash: "private-hash", deletedAt: 2_000 },
				],
			}),
			server: server(),
		});
		expect(result.push.tombstones).toEqual([]);
		expect(JSON.stringify(result.push)).not.toContain("private-hash");
		expect(writesOf(result, "drop-tombstone")).toEqual([
			{ kind: "drop-tombstone", id: "never" },
		]);
	});

	it("ignores a pushed document whose ID has a tombstone", () => {
		const after = applyPush(
			server({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 5_000 }],
			}),
			{
				documents: [serverDoc("a", { title: "Back", titleChangedAt: 9_000 })],
				uploads: ["a"],
				tombstones: [],
				sessions: [],
				settings: {},
				dailyGoalChanges: [],
				trainingResults: [],
			},
		);
		expect(after.server.documents).toEqual([]);
	});
});

describe("Keep on this device only", () => {
	const flipped = (at: number, on = true): DeviceDocument =>
		deviceDoc("a", { deviceOnly: on, deviceOnlyChangedAt: at });

	it("acts as a delete elsewhere for a synced document and keeps it here", () => {
		const result = synced({
			device: device({
				documents: [flipped(4_000)],
				sessions: [session("after", { documentId: "a" })],
			}),
			server: server({ documents: [serverDoc("a")] }),
		});
		expect(result.push.tombstones).toEqual([
			{ id: "a", contentHash: "hash-a", deletedAt: 4_000 },
		]);
		expect(result.push.documents).toEqual([]);
		expect(result.push.sessions).toEqual([]);
		expect(result.server.documents).toEqual([]);
		expect(result.device.documents).toEqual([flipped(4_000)]);
		expect(writesOf(result, "remove-document")).toEqual([]);
	});

	it("then removes the document from the other devices", () => {
		const after = synced({
			device: device({ documents: [deviceDoc("a")] }),
			server: server({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 4_000 }],
			}),
		});
		expect(writesOf(after, "remove-document")).toEqual([
			{ kind: "remove-document", id: "a" },
		]);
	});

	it("sends nothing at all about a device-only document the account never had", () => {
		const result = synced({
			device: device({
				documents: [
					deviceDoc("secret", {
						deviceOnly: true,
						title: "Medical letter",
						contentHash: "secret-hash",
					}),
				],
				sessions: [session("s", { documentId: "secret" })],
			}),
			server: server(),
		});
		const sent = JSON.stringify(result.push);
		expect(sent).not.toContain("secret");
		expect(sent).not.toContain("Medical letter");
		expect(result.push.sessions).toEqual([]);
		expect(result.device.sessions).toEqual([
			session("s", { documentId: "secret" }),
		]);
	});

	it("uploads a document as new when it is turned off after the delete elsewhere", () => {
		const onServer = session("old", { documentId: "a" });
		const notYet = session("new", { documentId: "a", startedAt: 7_000 });
		const result = synced({
			newId: () => "fresh",
			device: device({
				documents: [flipped(6_000, false)],
				sessions: [onServer, notYet],
			}),
			server: server({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 4_000 }],
				sessions: [onServer],
			}),
		});
		expect(writesOf(result, "rekey-document")).toEqual([
			{ kind: "rekey-document", from: "a", to: "fresh" },
		]);
		expect(result.push.uploads).toEqual(["fresh"]);
		expect(result.push.documents.map((each) => each.id)).toEqual(["fresh"]);
		expect(result.push.sessions).toEqual([{ ...notYet, documentId: "fresh" }]);
		expect(
			result.device.sessions.find((each) => each.id === "old")?.documentId,
		).toBe("a");
		expect(result.server.tombstones.map((each) => each.id)).toEqual(["a"]);
	});

	it("merges by hash instead when the account holds the text under another ID", () => {
		const result = synced({
			device: device({ documents: [flipped(6_000, false)] }),
			server: server({
				documents: [serverDoc("b", { contentHash: "hash-a" })],
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 4_000 }],
			}),
		});
		expect(writesOf(result, "rekey-document")).toEqual([
			{ kind: "rekey-document", from: "a", to: "b" },
		]);
		expect(result.push.uploads).toEqual([]);
	});

	it("lets the delete win when it was turned off before the delete", () => {
		const result = synced({
			device: device({ documents: [flipped(3_000, false)] }),
			server: server({
				tombstones: [{ id: "a", contentHash: "hash-a", deletedAt: 4_000 }],
			}),
		});
		expect(writesOf(result, "remove-document")).toEqual([
			{ kind: "remove-document", id: "a" },
		]);
		expect(result.push.uploads).toEqual([]);
	});

	it("never downloads the account's copy of a text kept device-only here", () => {
		const result = synced({
			device: device({
				documents: [deviceDoc("x", { contentHash: "h", deviceOnly: true })],
			}),
			server: server({ documents: [serverDoc("y", { contentHash: "h" })] }),
		});
		expect(writesOf(result, "add-document")).toEqual([]);
		expect(result.push.tombstones).toEqual([]);
		expect(result.server.documents).toEqual([
			serverDoc("y", { contentHash: "h" }),
		]);
	});
});

describe("same-hash documents merge", () => {
	const mine = deviceDoc("a", { contentHash: "h", ...read(4, 7_000) });
	const theirs = serverDoc("b", {
		contentHash: "h",
		title: "Their title",
		titleChangedAt: 2_000,
		...read(1, 3_000),
	});

	it("moves this copy to the account's ID, keeps the later Position and moves its Sessions", () => {
		const s = session("s", { documentId: "a" });
		const result = synced({
			device: device({ documents: [mine], sessions: [s] }),
			server: server({ documents: [theirs] }),
		});
		expect(result.writes[0]).toEqual({
			kind: "rekey-document",
			from: "a",
			to: "b",
		});
		const merged: SyncDocument = {
			...theirs,
			...read(4, 7_000),
		};
		expect(result.device.documents.map((each) => each.id)).toEqual(["b"]);
		expect(docIn(result.device, "b")).toMatchObject(merged);
		expect(result.push.documents).toEqual([merged]);
		expect(result.push.uploads).toEqual([]);
		expect(result.push.sessions).toEqual([{ ...s, documentId: "b" }]);
		expect(result.device.sessions).toEqual([{ ...s, documentId: "b" }]);
	});

	it("takes the account's Position when it is the later one", () => {
		const result = synced({
			device: device({
				documents: [{ ...mine, ...read(4, 1_000) }],
			}),
			server: server({ documents: [theirs] }),
		});
		expect(docIn(result.device, "b")).toMatchObject(read(1, 3_000));
	});

	it("is refused by the server when a new document's text is already in the account", () => {
		const after = applyPush(server({ documents: [theirs] }), {
			documents: [serverDoc("a", { contentHash: "h" })],
			uploads: ["a"],
			tombstones: [],
			sessions: [],
			settings: {},
			dailyGoalChanges: [],
			trainingResults: [],
		});
		expect(after.refused).toEqual([{ id: "a", existingId: "b" }]);
		expect(after.server.documents).toEqual([theirs]);
	});
});

describe("First sync", () => {
	it("uploads everything not device-only to an empty account, with no question", () => {
		const result = synced({
			device: device({
				generation: null,
				documents: [deviceDoc("a"), deviceDoc("b", { deviceOnly: true })],
				sessions: [session("s", { documentId: "a" })],
			}),
			server: server(),
		});
		expect(result.generation).toBe("g1");
		expect(result.push.uploads).toEqual(["a"]);
		expect(result.push.documents.map((each) => each.id)).toEqual(["a"]);
		expect(result.push.sessions).toEqual([session("s", { documentId: "a" })]);
	});

	it("downloads everything silently to an empty device, newest Position first", () => {
		const result = synced({
			device: device({ generation: null }),
			server: server({
				documents: [serverDoc("old", read(1, 1_000)), serverDoc("new", read(1, 5_000))],
				sessions: [session("s", { documentId: "old" })],
				settings: { libraryLineHidden: { value: true, changedAt: 3 } },
			}),
		});
		expect(writesOf(result, "add-document").map((each) => each.document.id).sort()).toEqual(["new", "old"]);
		expect(result.downloads).toEqual(["new", "old"]);
		expect(result.device.sessions).toEqual([
			session("s", { documentId: "old" }),
		]);
		expect(result.device.settings).toEqual({
			libraryLineHidden: { value: true, changedAt: 3 },
		});
		expect(result.push.documents).toEqual([]);
	});

	const mixed = () => ({
		device: device({
			generation: null,
			documents: [
				deviceDoc("match", { contentHash: "shared" }),
				deviceDoc("one"),
				deviceDoc("two"),
				deviceDoc("private", { deviceOnly: true }),
			],
			sessions: [
				session("s-one", { documentId: "one" }),
				session("s-match", { documentId: "match" }),
			],
		}),
		server: server({
			documents: [serverDoc("acct", { contentHash: "shared" })],
		}),
	});

	it("asks one question when both sides have documents, counting those the account lacks", () => {
		expect(run(mixed())).toEqual({ status: "question", documents: 2 });
	});

	it("adds them to the account on Add", () => {
		const result = synced({ ...mixed(), firstSyncAnswer: "add" });
		expect(result.push.uploads.sort()).toEqual(["one", "two"]);
		expect(writesOf(result, "rekey-document")).toEqual([
			{ kind: "rekey-document", from: "match", to: "acct" },
		]);
	});

	it("marks them device-only on Keep, keeps their Sessions here, and still merges the match", () => {
		const result = synced({ ...mixed(), firstSyncAnswer: "keep" });
		expect(writesOf(result, "set-device-only")).toEqual([
			{ kind: "set-device-only", id: "one", at: NOW },
			{ kind: "set-device-only", id: "two", at: NOW },
		]);
		expect(writesOf(result, "rekey-document")).toEqual([
			{ kind: "rekey-document", from: "match", to: "acct" },
		]);
		expect(result.push.uploads).toEqual([]);
		expect(result.push.sessions).toEqual([
			session("s-match", { documentId: "acct" }),
		]);
		const sent = JSON.stringify(result.push);
		expect(sent).not.toContain("hash-one");
		expect(sent).not.toContain("hash-two");
	});

	it("doesn't ask when every document here is already in the account", () => {
		const result = run({
			device: device({
				generation: null,
				documents: [deviceDoc("match", { contentHash: "shared" })],
			}),
			server: server({
				documents: [serverDoc("acct", { contentHash: "shared" })],
			}),
		});
		expect(result.status).toBe("synced");
	});

	it("runs again when the generation changes, and never within one generation", () => {
		const local = [deviceDoc("a")];
		const account = [serverDoc("b")];
		expect(
			run({
				device: device({ generation: "g1", documents: local }),
				server: server({ generation: "g2", documents: account }),
			}),
		).toEqual({ status: "question", documents: 1 });
		const same = synced({
			device: device({ generation: "g2", documents: local }),
			server: server({ generation: "g2", documents: account }),
		});
		expect(same.push.uploads).toEqual(["a"]);
	});

	it("uploads into a wiped server copy under the documents' own IDs", () => {
		const result = synced({
			device: device({
				generation: "g1",
				documents: [deviceDoc("a", read(3, 2_000))],
			}),
			server: server({ generation: "g2" }),
		});
		expect(result.generation).toBe("g2");
		expect(result.device.generation).toBe("g2");
		expect(result.push.uploads).toEqual(["a"]);
		expect(docIn(result.server, "a")).toMatchObject(read(3, 2_000));
	});
});

describe("what leaves the device", () => {
	it("is only the synced fields of a document, never its source URL", () => {
		const withLocalFields = {
			...deviceDoc("a"),
			sourceUrl: "https://private.example/page",
			createdAt: 1,
			sync: { pending: true, remoteId: null },
		};
		const result = synced({
			device: device({ documents: [withLocalFields] }),
			server: server(),
		});
		const sent = JSON.stringify(result.push);
		expect(sent).not.toContain("private.example");
		expect(Object.keys(result.push.documents[0] ?? {}).sort()).toEqual(
			Object.keys(serverDoc("a")).sort(),
		);
	});

	it("is nothing on a second sync with no changes", () => {
		const first = synced({
			device: device({
				generation: null,
				documents: [deviceDoc("a"), deviceDoc("p", { deviceOnly: true })],
				sessions: [session("s", { documentId: "p" })],
				tombstones: [{ id: "gone", contentHash: "x", deletedAt: 1 }],
			}),
			server: server({ documents: [serverDoc("b", read(2, 9))] }),
			firstSyncAnswer: "add",
		});
		const second = synced({ device: first.device, server: first.server });
		expect(second.writes).toEqual([]);
		expect(second.push).toEqual({
			documents: [],
			uploads: [],
			tombstones: [],
			sessions: [],
			settings: {},
			dailyGoalChanges: [],
			trainingResults: [],
		});
	});
});
