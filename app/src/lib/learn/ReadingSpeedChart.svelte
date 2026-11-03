<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { READING_SPEED } from "./articles.ts";

// A drawing of the numbers in the text, not a measurement of anything: the range most adults
// fall in for non-fiction, and the two averages, on one words-per-minute axis. The numbers
// come from READING_SPEED, which the unit tests tie to Brysbaert (2019).
const { nonFiction, fiction, rangeLow, rangeHigh } = READING_SPEED;

const MIN = 150;
const MAX = 325;
const LEFT = 16;
const WIDTH = 368;
const x = (wpm: number): number => LEFT + ((wpm - MIN) / (MAX - MIN)) * WIDTH;

const ticks = [150, 200, 250, 300];
</script>

<svg
	viewBox="0 0 400 160"
	class="block h-auto w-full"
	role="img"
	aria-label={m.learn_avg_chart_alt({
		low: rangeLow,
		high: rangeHigh,
		nonFiction,
		fiction,
	})}
>
	<g fill="currentColor" font-size="13" font-weight="650">
		<text x={LEFT} y="16" font-weight="500">{m.learn_avg_chart_unit()}</text>
		<text x={(x(rangeLow) + x(rangeHigh)) / 2} y="42" text-anchor="middle"
			>{m.learn_avg_chart_range()}</text
		>
		<rect
			x={x(rangeLow)}
			y="56"
			width={x(rangeHigh) - x(rangeLow)}
			height="20"
			fill="var(--color-rule)"
			stroke="currentColor"
			stroke-width="2"
		/>
		<line x1={x(MIN)} x2={x(MAX)} y1="66" y2="66" stroke="currentColor" stroke-width="2" />
		{#each ticks as tick (tick)}
			<line x1={x(tick)} x2={x(tick)} y1="76" y2="84" stroke="currentColor" stroke-width="2" />
			<text x={x(tick)} y="100" text-anchor="middle">{tick}</text>
		{/each}
		<line x1={x(nonFiction)} x2={x(nonFiction)} y1="50" y2="136" stroke="currentColor" stroke-width="4" />
		<text x={x(nonFiction) - 8} y="148" text-anchor="end"
			>{m.learn_avg_chart_nonfiction()} {nonFiction}</text
		>
		<line x1={x(fiction)} x2={x(fiction)} y1="50" y2="136" stroke="currentColor" stroke-width="4" />
		<text x={x(fiction) + 8} y="148"
			>{m.learn_avg_chart_fiction()} {fiction}</text
		>
	</g>
</svg>
