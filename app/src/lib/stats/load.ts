import { localDate } from "@speeedy/engine";
import type { LibraryStore } from "#lib/library/store.ts";
import { buildStatsView, type StatsView } from "./view.ts";

/** The setting that hides the progress line in the Library. */
export const LINE_HIDDEN_SETTING = "libraryLineHidden";

type StatsStore = Pick<
	LibraryStore,
	"sessions" | "dailyGoalChanges" | "settings"
>;

/** Reads the Sessions and goal changes and works out the stats view for today. */
export async function loadStats(
	store: StatsStore,
	now: number = Date.now(),
): Promise<{ view: StatsView; lineHidden: boolean; today: string }> {
	const [sessions, goalChanges, settings] = await Promise.all([
		store.sessions(),
		store.dailyGoalChanges(),
		store.settings(),
	]);
	const today = localDate(now);
	return {
		view: buildStatsView({ sessions, goalChanges, today }),
		lineHidden: settings[LINE_HIDDEN_SETTING]?.value === true,
		today,
	};
}
