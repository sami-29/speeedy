<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { type ChartPoint, SPEED_BANDS, type SpeedBandId } from "./view.ts";

let { points }: { points: ChartPoint[] } = $props();

/** The top of the plot: room above the fastest dot, never below 500 WPM. */
const top = $derived(
	Math.max(
		500,
		Math.ceil(Math.max(...points.map((p) => p.wpm)) / 100) * 100 + 50,
	),
);

const bandName = (id: SpeedBandId) =>
	({
		study: m.stats_band_study,
		read: m.stats_band_read,
		skim: m.stats_band_skim,
	})[id]();
const bandRange = (id: SpeedBandId) =>
	({
		study: m.stats_band_study_range,
		read: m.stats_band_read_range,
		skim: m.stats_band_skim_range,
	})[id]();

/** A band as a share of the plot's height, measured from the bottom. */
const bandBox = (min: number, upTo: number | null) => ({
	bottom: (min / top) * 100,
	height: (((upTo ?? top) - min) / top) * 100,
});

const latest = $derived(points[points.length - 1]);
</script>

<div
	class="chart"
	data-testid="speed-chart"
	role="img"
	aria-label={m.stats_speed_label({ count: points.length, latest: latest?.wpm ?? 0 })}
>
	{#each SPEED_BANDS as band, i (band.id)}
		{@const box = bandBox(band.min, band.upTo)}
		<div
			class="band"
			class:alt={i % 2 === 0}
			style:bottom="{box.bottom}%"
			style:height="{box.height}%"
		>
			<span class="band-name">{bandName(band.id)}</span>
			<span class="band-range caption">{bandRange(band.id)}</span>
		</div>
	{/each}
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

	.band {
		position: absolute;
		inset-inline: 0;
		border-top: 2px solid var(--color-rule);
		padding: 4px 0 0 var(--spacing-s-1);
		line-height: 1.2;
	}

	.band.alt {
		background: var(--color-paper-2);
	}

	.band-name {
		display: block;
		font-size: 0.9375rem;
		font-weight: 750;
		color: var(--color-ink);
	}

	.band-range {
		color: var(--color-ink-2);
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
