import type {
	Push,
	Refusal,
	ServerState,
	SyncInput,
	SyncResult,
} from "./types.ts";

/** The settings that sync. Every other key stays on the device. */
export const SYNCED_SETTINGS: readonly string[] = [];

export function syncDevice(_input: SyncInput): SyncResult {
	throw new Error("not implemented");
}

export function applyPush(
	_server: ServerState,
	_push: Push,
): { server: ServerState; refused: Refusal[] } {
	throw new Error("not implemented");
}
