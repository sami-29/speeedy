/**
 * Umami v2 helpers. No-ops if the script is missing or blocked.
 * https://v2.umami.is/docs/tracker-functions
 */

declare global {
	interface Window {
		umami?: {
			track(event: string): void;
			track(
				event: string,
				data: Record<string, string | number | boolean>,
			): void;
			track(
				callback: (
					props: Record<string, string>,
				) => Record<string, string | number | boolean>,
			): void;
		};
	}
}

export function trackEvent(
	event: string,
	data?: Record<string, string | number | boolean>,
): void {
	try {
		if (!window.umami) return;
		if (data) {
			window.umami.track(event, data);
		} else {
			window.umami.track(event);
		}
	} catch {
		/* no-op */
	}
}

/** Manual pageview for hash SPA routes (Umami auto-tracks first load only). */
export function trackPageview(path: string, title?: string): void {
	try {
		if (!window.umami) return;
		window.umami.track((props) => ({
			...props,
			url: path,
			...(title ? { title } : {}),
		}));
	} catch {
		/* no-op */
	}
}

/** Coarse WPM bracket for analytics (not exact values). */
export function wpmBracket(wpm: number): string {
	if (wpm < 100) return "<100";
	if (wpm < 200) return "100-199";
	if (wpm < 300) return "200-299";
	if (wpm < 400) return "300-399";
	if (wpm < 500) return "400-499";
	if (wpm < 600) return "500-599";
	return "600+";
}

export function comprehensionBracket(pct: number): string {
	if (pct < 50) return "<50%";
	if (pct < 70) return "50-69%";
	if (pct < 90) return "70-89%";
	return "90-100%";
}
