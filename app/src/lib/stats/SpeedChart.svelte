<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import ZoneBands from "#lib/reader/ZoneBands.svelte";
import { chartTop } from "#lib/reader/zones.ts";
import type { ChartPoint } from "./view.ts";

let { points }: { points: ChartPoint[] } = $props();

/** The top of the plot: room above the fastest dot, never below 500 WPM. */
const top = $derived(chartTop(Math.max(...points.map((p) => p.wpm))));

const latest = $derived(points[points.length - 1]);
</script>

<div
	class="chart"
	data-testid="speed-chart"
	role="img"
	aria-label={m.stats_speed_label({ count: points.length, latest: latest?.wpm ?? 0 })}
>
	<ZoneBands {top} />
	<div class="plot">
		{#each points as point, i (point.id)}
			<span
				class="dot"
				class:latest={i === points.length - 1}
				data-testid="speed-point"
				data-band={point.band}
				style:left="{((i + 0.5) / points.length) * 100}%"
				style:bottom="{(point.wpm / top) * 100}%"
			></span>
		{/each}
	</div>
</div>

<style>
	.chart {
		position: relative;
		height: 240px;
		border-bottom: 4px solid var(--color-ink);
	}

	/* The dots sit to the right of the band names. */
	.plot {
		position: absolute;
		inset-block: 0;
		left: 6.5rem;
		right: var(--spacing-s-1);
	}

	/* A dot is a mark in a plot, the one round form in the system. */
	.dot {
		position: absolute;
		width: 12px;
		height: 12px;
		margin: 0 0 -6px -6px;
		border-radius: 50%;
		background: var(--color-ink);
	}

	/* Red marks where the reader is now: the latest Session. */
	.dot.latest {
		width: 18px;
		height: 18px;
		margin: 0 0 -9px -9px;
		background: var(--color-red);
	}
</style>
