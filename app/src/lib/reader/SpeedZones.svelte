<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { zoneName, zoneNote, zoneRange } from "./copy.ts";
import { SPEED_ZONES, zoneFor } from "./zones.ts";

let { wpm, onpick }: { wpm: number; onpick: (wpm: number) => void } = $props();

const current = $derived(zoneFor(wpm));
</script>

<div>
	<div role="group" aria-label={m.reader_zones_label()} class="zones">
		{#each SPEED_ZONES as zone (zone.id)}
			<button
				type="button"
				class="zone"
				aria-pressed={current.id === zone.id}
				onclick={() => onpick(zone.target)}
			>
				<span class="swatch" aria-hidden="true"></span>
				<span class="name">{zoneName(zone.id)}</span>
				<span class="range">{zoneRange(zone)}</span>
			</button>
		{/each}
	</div>
	<p class="caption mt-s-1 max-w-[52ch] text-ink-2" data-testid="zone-note">
		{zoneNote(current.id)}
	</p>
</div>

<style>
	.zones {
		display: grid;
		border-top: 2px solid var(--color-ink);
	}

	.zone {
		display: grid;
		grid-template-columns: 18px 1fr auto;
		align-items: center;
		gap: var(--spacing-s-2);
		min-height: 44px;
		padding-inline: var(--spacing-s-1);
		border-bottom: 2px solid var(--color-rule);
		color: var(--color-ink-3);
		font-weight: 750;
		text-align: left;
		cursor: pointer;
	}

	.zone:hover {
		background: var(--color-paper-2);
	}

	.zone[aria-pressed="true"] {
		color: var(--color-ink);
	}

	/* Stroked when it is not the current zone, filled red when it is: red means "now". */
	.swatch {
		width: 18px;
		height: 18px;
		box-shadow: inset 0 0 0 2px var(--color-ink-3);
	}

	.zone[aria-pressed="true"] .swatch {
		background: var(--color-red);
		box-shadow: none;
	}

	.range {
		font-feature-settings: "tnum";
		font-weight: 600;
	}
</style>
