/** Hand the browser a file to save. The file never leaves the device. */
export function saveFile(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.hidden = true;
	document.body.append(link);
	link.click();
	link.remove();
	// The download has started by the next task; release the blob after a moment.
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
