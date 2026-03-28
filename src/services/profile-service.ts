import type { ShareData, UserProfile } from "../models/types.js";
import { getAverageWpm, getRecentWpms } from "./stats-service.js";

export function buildShareData(profile: UserProfile): ShareData {
	return {
		displayName: profile.displayName,
		avatarEmoji: profile.avatarEmoji,
		totalWordsRead: profile.totalWordsRead,
		totalTimeMs: profile.totalTimeMs,
		avgWpm: getAverageWpm(profile),
		currentStreak: profile.currentStreak,
		bestStreak: profile.bestStreak,
		recentWpms: getRecentWpms(profile, 10),
	};
}

export function encodeShareData(data: ShareData): string {
	const json = JSON.stringify(data);
	return btoa(encodeURIComponent(json));
}

export function decodeShareData(encoded: string): ShareData | null {
	try {
		const json = decodeURIComponent(atob(encoded));
		return JSON.parse(json) as ShareData;
	} catch {
		return null;
	}
}

export function generateShareUrl(data: ShareData): string {
	const encoded = encodeShareData(data);
	const base = window.location.origin + window.location.pathname;
	return `${base}#/share/${encoded}`;
}

export async function downloadProfileBackup(
	profile: UserProfile,
): Promise<void> {
	const json = JSON.stringify(profile, null, 2);
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `speeedy-profile-${profile.displayName.replace(/\s+/g, "-")}.speeedy`;
	a.click();
	URL.revokeObjectURL(url);
}

export async function loadProfileFromFile(file: File): Promise<UserProfile> {
	const text = await file.text();
	const raw = JSON.parse(text);
	if (
		!raw ||
		typeof raw !== "object" ||
		typeof raw.id !== "string" ||
		typeof raw.displayName !== "string" ||
		!Array.isArray(raw.sessions) ||
		typeof raw.settings !== "object"
	) {
		throw new Error("Invalid profile file.");
	}
	return raw as UserProfile;
}
