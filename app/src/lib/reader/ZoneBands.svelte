<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { bandBox, type SpeedZoneId, ZONE_BANDS } from "./zones.ts";

/**
 * The Speed Zone bands behind a speed chart. Place it in a positioned box; the bands fill
 * the box's width and stack from the bottom up to `top` WPM.
 */
let { top, ranges = true }: { top: number; ranges?: boolean } = $props();

const bandName = (id: SpeedZoneId) =>
	({
		study: m.stats_band_study,
		read: m.stats_band_read,
		skim: m.stats_band_skim,
	})[id]();
const bandRange = (id: SpeedZoneId) =>
	({
		study: m.stats_band_study_range,
		read: m.stats_band_read_range,
		skim: m.stats_band_skim_range,
	})[id]();
</script>

{#each ZONE_BANDS as band, i (band.id)}
	{@const box = bandBox(band, top)}
	<div
		class="band"
		class:alt={i % 2 === 0}
		data-band={band.id}
		style:bottom="{box.bottom}%"
		style:height="{box.height}%"
	>
		<span class="band-name">{bandName(band.id)}</span>
		{#if ranges}
			<span class="band-range caption">{bandRange(band.id)}</span>
		{/if}
	</div>
{/each}

<style>
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
</style>
