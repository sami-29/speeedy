<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { zoneName } from "./copy.ts";
import {
	stepWpm,
	WPM_MAX,
	WPM_MIN,
	WPM_STEP,
	wpmForKey,
	wpmFromDrag,
} from "./wpm.ts";
import { zoneFor } from "./zones.ts";

let { wpm, onchange }: { wpm: number; onchange: (wpm: number) => void } =
	$props();

// Where a drag began. Plain variables: the drag itself changes `wpm`, not these.
let dragX = 0;
let dragWpm = 0;
let dragging = $state(false);

const valueText = $derived(
	m.reader_speed_text({ wpm, zone: zoneName(zoneFor(wpm).id) }),
);

function onKeydown(event: KeyboardEvent) {
	const next = wpmForKey(event, wpm);
	if (next === undefined) return;
	event.preventDefault();
	if (next !== wpm) onchange(next);
}

function onPointerDown(event: PointerEvent) {
	if (event.button !== 0) return;
	dragX = event.clientX;
	dragWpm = wpm;
	dragging = true;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
	if (!dragging) return;
	const next = wpmFromDrag(dragWpm, event.clientX - dragX);
	if (next !== wpm) onchange(next);
}

function endDrag(event: PointerEvent) {
	dragging = false;
	const target = event.currentTarget as HTMLElement;
	if (target.hasPointerCapture(event.pointerId)) {
		target.releasePointerCapture(event.pointerId);
	}
}
</script>

<div class="wpm">
	<div class="readout" data-testid="wpm">
		<span
			class="numeral value"
			class:dragging
			role="slider"
			tabindex="0"
			aria-label={m.reader_speed_label()}
			aria-valuemin={WPM_MIN}
			aria-valuemax={WPM_MAX}
			aria-valuenow={wpm}
			aria-valuetext={valueText}
			onkeydown={onKeydown}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={endDrag}
			onpointercancel={endDrag}>{wpm}</span
		>
		<span class="unit label">{m.reader_wpm_unit()}</span>
	</div>
	<div class="steps">
		<button
			type="button"
			class="stepper"
			aria-label={m.reader_slower()}
			disabled={wpm <= WPM_MIN}
			onclick={() => onchange(stepWpm(wpm, -WPM_STEP))}>−</button
		>
		<button
			type="button"
			class="stepper"
			aria-label={m.reader_faster()}
			disabled={wpm >= WPM_MAX}
			onclick={() => onchange(stepWpm(wpm, WPM_STEP))}>+</button
		>
	</div>
</div>

<style>
	/* The numeral gets the whole column; the steppers sit under it, so four digits at the
	   top speed never run into the axis. They line up with the headline side of the axis. */
	.wpm {
		display: grid;
		gap: var(--spacing-s-1);
		justify-items: start;
		min-width: 0;
	}

	@media (min-width: 861px) {
		.wpm {
			justify-items: end;
		}
	}

	.readout {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-s-1);
		min-width: 0;
	}

	.steps {
		display: flex;
		gap: var(--spacing-s-1);
	}

	/* The numeral is the control: drag it sideways, or use the arrow keys. Vertical
	   panning stays with the page so a touch can still scroll. */
	.value {
		font-size: clamp(4.5rem, 2.5rem + 5vw, 9rem);
		cursor: ew-resize;
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
	}

	.value.dragging {
		cursor: grabbing;
	}

	.unit {
		white-space: nowrap;
	}
</style>
