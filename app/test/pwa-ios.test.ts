import { describe, expect, it } from "vitest";
import { showsIosInstallHint } from "../src/lib/pwa/ios.ts";

const IPHONE =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

const env = (over: Partial<Parameters<typeof showsIosInstallHint>[0]>) => ({
	userAgent: IPHONE,
	platform: "iPhone",
	maxTouchPoints: 5,
	standalone: false,
	...over,
});

describe("showsIosInstallHint", () => {
	it("shows on iPhone Safari", () => {
		expect(showsIosInstallHint(env({}))).toBe(true);
	});

	it("shows on an iPad that reports a Mac desktop agent", () => {
		expect(
			showsIosInstallHint(
				env({
					userAgent: IPAD_DESKTOP_UA,
					platform: "MacIntel",
					maxTouchPoints: 5,
				}),
			),
		).toBe(true);
	});

	it("stays away once the app runs from the Home Screen", () => {
		expect(showsIosInstallHint(env({ standalone: true }))).toBe(false);
	});

	it("stays away on a real Mac, on Android and on other desktops", () => {
		expect(
			showsIosInstallHint(
				env({
					userAgent: IPAD_DESKTOP_UA,
					platform: "MacIntel",
					maxTouchPoints: 0,
				}),
			),
		).toBe(false);
		expect(
			showsIosInstallHint(
				env({ userAgent: ANDROID, platform: "Linux armv8l" }),
			),
		).toBe(false);
		expect(
			showsIosInstallHint(
				env({
					userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0",
					platform: "Linux x86_64",
					maxTouchPoints: 0,
				}),
			),
		).toBe(false);
	});
});
