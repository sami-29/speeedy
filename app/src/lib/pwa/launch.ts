/**
 * The slice of the Launch Handler API that `file_handlers` uses. When the OS opens a file with
 * the installed app, the browser loads the handler's `action` (`/reader`) and queues the file
 * handles here. Chromium only; elsewhere there is no queue and nothing happens.
 */
export type LaunchParams = {
	files?: readonly { getFile(): Promise<File> }[];
};

export type LaunchQueue = {
	setConsumer(consumer: (params: LaunchParams) => unknown): void;
};

/**
 * Hand the first launched file to `onFile`. A launch with no file (the app icon) and a handle
 * the browser will not read are both ignored, leaving the reader as it is.
 */
export function consumeLaunchFiles(
	queue: LaunchQueue | undefined,
	onFile: (file: File) => void,
): void {
	queue?.setConsumer(async (params) => {
		const handle = params.files?.[0];
		if (!handle) return;
		try {
			onFile(await handle.getFile());
		} catch {
			// Permission refused or the file moved: nothing to open.
		}
	});
}
