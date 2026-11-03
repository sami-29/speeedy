<script lang="ts">
import { onMount } from "svelte";
import { library } from "#lib/library/instance.ts";
import { m } from "#lib/paraglide/messages.js";
import { LINE_HIDDEN_SETTING, loadStats } from "./load.ts";
import type { StatsView } from "./view.ts";

let view = $state.raw<StatsView>();
let hidden = $state(false);

onMount(() => {
	loadStats(library())
		.then((loaded) => {
			view = loaded.view;
			hidden = loaded.lineHidden;
		})
		.catch(() => {
			// The Library is out of reach: the page says so elsewhere, this line just stays away.
		});
});

async function hide() {
	hidden = true;
	try {
		await library().setSetting(LINE_HIDDEN_SETTING, true);
	} catch {
		// The line is hidden for this visit even if the choice could not be kept.
	}
}

const line = $derived(
	view
		? `${m.stats_line_today({ minutes: view.today.minutes, goal: view.today.goalMinutes })} · ${
				view.streak.current > 0
					? m.stats_line_streak({ days: view.streak.current })
					: m.stats_line_no_streak()
			}`
		: "",
);
</script>

{#if view && !hidden}
	<div class="mb-s-2 flex flex-wrap items-center gap-s-2" role="group" aria-label={m.stats_line_label()}>
		<p class="label" data-testid="library-line">{line}</p>
		<button type="button" class="segment border-2 border-ink" onclick={hide}>
			{m.stats_line_hide()}
		</button>
	</div>
{/if}
