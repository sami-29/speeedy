import type { ReadingSession, UserProfile } from "../models/types.js";
import { saveProfile } from "./storage-service.js";

export function recordSession(
	profile: UserProfile,
	session: Omit<ReadingSession, "id">,
): UserProfile {
	const newSession: ReadingSession = {
		...session,
		id: crypto.randomUUID(),
	};

	const updatedSessions = [...profile.sessions, newSession].slice(-500);
	const today = new Date().toISOString().split("T")[0];

	const newStreak = computeStreak(profile, today);
	const totalWordsRead = profile.totalWordsRead + session.wordsRead;
	const totalTimeMs = profile.totalTimeMs + session.durationMs;

	const updated: UserProfile = {
		...profile,
		sessions: updatedSessions,
		totalWordsRead,
		totalTimeMs,
		currentStreak: newStreak,
		bestStreak: Math.max(profile.bestStreak, newStreak),
		lastReadDate: today,
	};

	saveProfile(updated);
	return updated;
}

function computeStreak(profile: UserProfile, today: string): number {
	const lastDate = profile.lastReadDate;
	if (!lastDate) return 1;
	if (lastDate === today) return profile.currentStreak;

	const last = new Date(`${lastDate}T00:00:00`);
	const todayDate = new Date(`${today}T00:00:00`);
	const diff = Math.round((todayDate.getTime() - last.getTime()) / 86400000);

	if (diff === 1) return profile.currentStreak + 1;
	return 1;
}

export function getAverageWpm(profile: UserProfile): number {
	const sessions = profile.sessions.filter((s) => s.wpm > 0);
	if (sessions.length === 0) return 0;
	const total = sessions.reduce((sum, s) => sum + s.wpm, 0);
	return Math.round(total / sessions.length);
}

export function getDailyWordsRead(
	profile: UserProfile,
	days = 30,
): { date: string; words: number }[] {
	const map = new Map<string, number>();
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - days);

	for (const session of profile.sessions) {
		const date = session.date.split("T")[0];
		if (new Date(date) < cutoff) continue;
		map.set(date, (map.get(date) ?? 0) + session.wordsRead);
	}

	const result: { date: string; words: number }[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		const key = d.toISOString().split("T")[0];
		result.push({ date: key, words: map.get(key) ?? 0 });
	}
	return result;
}

export function getRecentWpms(profile: UserProfile, count = 20): number[] {
	return profile.sessions
		.filter((s) => s.wpm > 0)
		.slice(-count)
		.map((s) => s.wpm);
}

export function getTodayWords(profile: UserProfile): number {
	const today = new Date().toISOString().split("T")[0];
	return profile.sessions
		.filter((s) => s.date.startsWith(today))
		.reduce((sum, s) => sum + s.wordsRead, 0);
}

export function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

export function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toString();
}
