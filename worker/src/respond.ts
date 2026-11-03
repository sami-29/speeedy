/** A JSON response that is never cached and never sets a cookie. */
export function json(
	status: number,
	body: unknown,
	headers?: HeadersInit,
): Response {
	const response = Response.json(body, { status, headers });
	response.headers.set("cache-control", "no-store");
	return response;
}

export function notFound(): Response {
	return json(404, { error: "not_found" });
}
