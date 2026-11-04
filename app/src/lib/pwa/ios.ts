export type IosProbe = {
	userAgent: string;
	platform: string;
	maxTouchPoints: number;
	/** `navigator.standalone`, which only Safari on iOS sets, true from the Home Screen. */
	standalone: boolean;
};

/**
 * Whether to show the Add to Home Screen line. Safari on iOS has no install prompt, so the
 * line says how to do it by hand. It is a sentence on the page, never a popup. iPadOS 13 and
 * later reports a Mac desktop agent, so a Mac with a touch screen counts as an iPad.
 */
export function showsIosInstallHint(probe: IosProbe): boolean {
	if (probe.standalone) return false;
	if (/iPhone|iPad|iPod/.test(probe.userAgent)) return true;
	return probe.platform === "MacIntel" && probe.maxTouchPoints > 1;
}
