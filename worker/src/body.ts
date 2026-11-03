/** Reads the body as text, or returns null as soon as it passes the cap. */
export async function readCapped(
	request: Request,
	maxBytes: number,
): Promise<string | null> {
	const declared = Number(request.headers.get("content-length"));
	if (declared > maxBytes) return null;
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}
