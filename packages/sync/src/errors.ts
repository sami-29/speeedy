export type SyncErrorCode = "invalid-argument";

/** Thrown for input the merge cannot interpret. Nothing is changed when it is thrown. */
export class SyncError extends Error {
	readonly code: SyncErrorCode;

	constructor(code: SyncErrorCode, message: string) {
		super(message);
		this.name = "SyncError";
		this.code = code;
	}
}
