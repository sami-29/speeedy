<script lang="ts">
import { formatDuration, formatNumber } from "@speeedy/engine";
import { onMount } from "svelte";
import { library } from "#lib/library/instance.ts";
import { m } from "#lib/paraglide/messages.js";
import { LINE_HIDDEN_SETTING, loadStats } from "#lib/stats/load.ts";
import SpeedChart from "#lib/stats/SpeedChart.svelte";
import type { StatsView } from "#lib/stats/view.ts";

let view = $state.raw<StatsView>();
let today = $state("");
let lineHidden = $state(false);
let error = $state("");
let goalDraft = $state("");
let goalError = $state("");

/** A date key as a short local day name, "Mon 3". */
const dayName = (date: string) => {
	const [year, month, day] = date.split("-").map(Number) as [
		number,
		number,
		number,
	];
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
	}).format(new Date(year, month - 1, day));
};

async function refresh() {
	try {
		const loaded = await loadStats(library());
		view = loaded.view;
		today = loaded.today;
		lineHidden = loaded.lineHidden;
		goalDraft = String(loaded.view.today.goalMinutes);
		error = "";
	} catch {
		error = m.library_error_storage();
	}
}

onMount(() => {
	void refresh();
});

async function saveGoal(event: SubmitEvent) {
	event.preventDefault();
	const minutes = Number(goalDraft);
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
		goalError = m.stats_goal_error();
		return;
	}
	goalError = "";
	try {
		await library().setDailyGoal({ minutes, effectiveDate: today });
		await refresh();
	} catch {
		goalError = m.library_error_storage();
	}
}

async function toggleLine(event: Event) {
	const show = (event.currentTarget as HTMLInputElement).checked;
	lineHidden = !show;
	try {
		await library().setSetting(LINE_HIDDEN_SETTING, !show);
	} catch {
		error = m.library_error_storage();
	}
}

const dayStatus = (day: { goalMet: boolean; readingDay: boolean }) =>
	day.goalMet
		? m.stats_day_goal_met()
		: day.readingDay
			? m.stats_day_reading_day()
			: m.stats_day_none();
</script>

<svelte:head>
	<title>{m.nav_stats()} - {m.site_name()}</title>
</svelte:head>

<div class="poster pt-s-6">
	<h1 class="headline poster-head">{m.app_stats_title()}</h1>
	<div>
		{#if error}
			<p role="alert" class="label text-red-ink">{error}</p>
		{:else if view && view.totals.sessions === 0}
			<p class="lead max-w-[52ch]" data-testid="stats-empty">{m.stats_empty()}</p>
		{:else if view}
			<p class="lead max-w-[52ch]" data-testid="stats-totals">
				{m.stats_totals({
					sessions: formatNumber(view.totals.sessions),
					words: formatNumber(view.totals.wordsRead),
					time: formatDuration(view.totals.activeMs),
					wpm: view.totals.averageWpm,
				})}
			</p>
		{/if}
	</div>

	{#if view}
		<h2 class="title poster-head">{m.stats_today_title()}</h2>
		<div class="rule-heavy pt-s-2">
			<p class="figure">
				<span data-testid="stats-today-minutes">{view.today.minutes}</span>
				<span class="figure-unit">{m.stats_today_unit()}</span>
			</p>
			<p class="label mt-s-2">
				{m.stats_goal_current()}: <span data-testid="stats-goal">{view.today.goalMinutes}</span>
				{m.stats_unit_min()}
			</p>
			<form class="mt-s-3 grid max-w-[40ch] gap-s-1" onsubmit={saveGoal}>
				<label for="goal" class="label block">{m.stats_goal_label()}</label>
				<div class="flex flex-wrap items-center gap-s-1">
					<input
						id="goal"
						type="number"
						inputmode="numeric"
						min="1"
						max="1440"
						step="1"
						class="block min-h-11 w-28 border-2 border-ink bg-paper p-s-1 text-ink"
						bind:value={goalDraft}
					/>
					<button type="submit" class="segment border-2 border-ink">{m.stats_goal_save()}</button>
				</div>
				{#if goalError}
					<p role="alert" class="label text-red-ink">{goalError}</p>
				{/if}
				<p class="caption text-ink-2">{m.stats_goal_note()}</p>
			</form>
		</div>

		<h2 class="title poster-head">{m.stats_streak_title()}</h2>
		<div class="rule-heavy pt-s-2">
			<p class="figure">
				<span data-testid="stats-current-streak">{view.streak.current}</span>
				<span class="figure-unit">{m.stats_streak_unit()}</span>
			</p>
			<p class="label mt-s-2">
				{m.stats_streak_best()}: <span data-testid="stats-best-streak">{view.streak.best}</span>
			</p>
			<p class="caption mt-s-1 max-w-[52ch] text-ink-2">{m.stats_streak_note()}</p>
		</div>

		{#if view.chart.length > 0}
			<h2 class="title poster-head">{m.stats_speed_title()}</h2>
			<div class="rule-heavy pt-s-2">
				<SpeedChart points={view.chart} />
				<p class="caption mt-s-1 text-ink-2">{m.stats_speed_note()}</p>
			</div>
		{/if}

		<h2 class="title poster-head">{m.stats_days_title()}</h2>
		<div class="rule-heavy">
			<table class="w-full border-collapse text-left">
				<caption class="sr-only">{m.stats_days_title()}</caption>
				<thead>
					<tr>
						<th scope="col" class="caption py-s-1 pr-s-2">{m.stats_days_col_day()}</th>
						<th scope="col" class="caption py-s-1 pr-s-2 text-right">{m.stats_days_col_time()}</th>
						<th scope="col" class="caption py-s-1 pr-s-2 text-right">{m.stats_days_col_goal()}</th>
						<th scope="col" class="caption py-s-1">{m.stats_days_col_status()}</th>
					</tr>
				</thead>
				<tbody>
					{#each [...view.week].reverse() as day (day.date)}
						<tr class="border-t-2 border-rule" data-testid="day-{day.date}">
							<td class="py-s-1 pr-s-2">{dayName(day.date)}</td>
							<td class="py-s-1 pr-s-2 text-right whitespace-nowrap">{formatDuration(day.activeMs)}</td>
							<td class="py-s-1 pr-s-2 text-right" data-testid="goal-{day.date}">{day.goalMinutes}</td>
							<td class="py-s-1">{dayStatus(day)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if view.recent.length > 0}
			<h2 class="title poster-head">{m.stats_sessions_title()}</h2>
			<div class="rule-heavy">
				<table class="w-full border-collapse text-left">
					<caption class="sr-only">{m.stats_sessions_title()}</caption>
					<thead>
						<tr>
							<th scope="col" class="caption py-s-1 pr-s-2">{m.stats_sessions_col_date()}</th>
							<th scope="col" class="caption py-s-1 pr-s-2 text-right">{m.stats_sessions_col_time()}</th>
							<th scope="col" class="caption py-s-1 pr-s-2 text-right">{m.stats_sessions_col_words()}</th>
							<th scope="col" class="caption py-s-1 text-right">{m.stats_sessions_col_wpm()}</th>
						</tr>
					</thead>
					<tbody>
						{#each view.recent as each (each.id)}
							<tr class="border-t-2 border-rule" data-testid="session-row">
								<td class="py-s-1 pr-s-2">{dayName(each.date)}</td>
								<td class="py-s-1 pr-s-2 text-right whitespace-nowrap">{formatDuration(each.activeMs)}</td>
								<td class="py-s-1 pr-s-2 text-right">{formatNumber(each.wordsRead)}</td>
								<td class="py-s-1 text-right">{each.wpm}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="poster-head"></div>
		<div class="rule-heavy pt-s-2">
			<label class="flex items-start gap-s-1 label">
				<input type="checkbox" class="mt-1 size-5 accent-ink" checked={!lineHidden} onchange={toggleLine} />
				<span>
					{m.stats_line_toggle()}
					<span class="caption block text-ink-2">{m.stats_line_toggle_note()}</span>
				</span>
			</label>
		</div>
	{/if}
</div>

<style>
	/* The stats numeral: display type one step under the Benchmark's, set wide. */
	.figure {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: var(--spacing-s-1);
		margin: 0;
		font-size: clamp(5rem, 3.5rem + 5vw, 9rem);
		font-weight: 830;
		line-height: 0.9;
		letter-spacing: -0.05em;
		font-variation-settings: "wdth" 112;
	}

	.figure-unit {
		font-size: clamp(1.25rem, 1rem + 1vw, 1.75rem);
		font-weight: 650;
		letter-spacing: 0;
		font-variation-settings: "wdth" 100;
	}
</style>
