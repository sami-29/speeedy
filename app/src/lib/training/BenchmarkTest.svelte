<script lang="ts">
import { formatNumber } from "@speeedy/engine";
import { onMount, tick } from "svelte";
import { library } from "#lib/library/instance.ts";
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import SpeedChart from "#lib/stats/SpeedChart.svelte";
import { createBenchmark } from "./benchmark/controller.ts";
import { BENCHMARK_PASSAGES } from "./benchmark/passages.ts";
import {
	type BenchmarkTrend,
	buildBenchmarkTrend,
	saveBenchmarkResult,
} from "./benchmark/results.ts";
import { rangeStanding } from "./benchmark/score.ts";

// The Benchmark drill: a timed passage, then ten questions, then the speed and the score. It
// prerenders as its intro and turns into the test once the page has hydrated. The passage
// is not in the page until the reader presses Start.
const bench = createBenchmark({
	passages: BENCHMARK_PASSAGES,
	now: () => performance.now(),
	random: Math.random,
});

let snap = $state.raw(bench.state());
let ready = $state(false);
let trend = $state.raw<BenchmarkTrend>();
let saved = $state(false);
let error = $state("");
let heading = $state<HTMLElement>();

const reading = $derived(snap.phase === "reading");
const answered = $derived(snap.answers.filter((each) => each !== null).length);
const complete = $derived(
	snap.questions.length > 0 && answered === snap.questions.length,
);
const standing = $derived(
	snap.result ? rangeStanding(snap.result.wpm) : "within",
);

const date = (key: string) => {
	const [year, month, day] = key.split("-").map(Number) as [
		number,
		number,
		number,
	];
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
		new Date(year, month - 1, day),
	);
};

async function loadTrend() {
	try {
		trend = buildBenchmarkTrend(await library().trainingResults());
	} catch {
		trend = undefined;
	}
}

onMount(() => {
	ready = true;
	void loadTrend();
});

/** Moves keyboard and screen-reader focus to the new step's heading. */
async function advance() {
	snap = bench.state();
	await tick();
	heading?.focus();
	if (typeof window !== "undefined") window.scrollTo({ top: 0 });
}

function start() {
	saved = false;
	error = "";
	bench.start();
	void advance();
}

function done() {
	bench.finishReading();
	void advance();
}

function choose(question: number, option: number) {
	bench.answer(question, option);
	snap = bench.state();
}

async function submit() {
	const result = bench.submit();
	if (!result) return;
	void advance();
	try {
		await saveBenchmarkResult(library(), result);
		saved = true;
		await loadTrend();
	} catch {
		error = m.library_error_storage();
	}
}

function again() {
	bench.again();
	void advance();
}
</script>

<div class="benchmark" data-testid="benchmark" data-phase={snap.phase} data-ready={ready}>
	{#if snap.phase === "intro"}
		<ul class="facts label" data-testid="benchmark-facts">
			<li>{m.benchmark_fact_length()}</li>
			<li>{m.benchmark_fact_pace()}</li>
			<li>{m.benchmark_fact_questions()}</li>
		</ul>
		<div class="mt-s-3 grid justify-items-start gap-s-1">
			<button
				type="button"
				class="button-primary"
				data-testid="benchmark-start"
				disabled={!ready}
				onclick={start}
			>
				{m.benchmark_start()}
			</button>
			<p class="caption text-ink-2">{m.benchmark_start_note()}</p>
		</div>
	{:else if reading && snap.passage}
		<h2 class="title" tabindex="-1" bind:this={heading}>{m.benchmark_reading_title()}</h2>
		<p class="caption mt-s-1 text-ink-2">
			{m.benchmark_reading_label({ title: snap.passage.title, words: snap.passage.words })}
		</p>
		<div class="passage mt-s-3" data-testid="benchmark-passage">
			{#each snap.passage.paragraphs as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}
		</div>
		<div class="done-bar">
			<button type="button" class="button-primary" data-testid="benchmark-done" onclick={done}>
				{m.benchmark_done()}
			</button>
			<p class="caption text-ink-2">{m.benchmark_done_note()}</p>
		</div>
	{:else if snap.phase === "quiz"}
		<h2 class="title" tabindex="-1" bind:this={heading}>{m.benchmark_quiz_title()}</h2>
		<p class="caption mt-s-1 text-ink-2" data-testid="benchmark-progress" aria-live="polite">
			{m.benchmark_quiz_progress({ answered, total: snap.questions.length })}
		</p>
		<form
			class="mt-s-3 grid gap-s-4"
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			{#each snap.questions as question, q (question.q)}
				<fieldset class="grid gap-s-1" data-testid="benchmark-question">
					<legend class="label mb-s-1">
						<span class="text-ink-2">{q + 1}.</span>
						{question.q}
					</legend>
					{#each question.options as option, o (option)}
						<label class="option">
							<input
								type="radio"
								name="question-{q}"
								value={o}
								checked={snap.answers[q] === o}
								onchange={() => choose(q, o)}
							/>
							<span>{option}</span>
						</label>
					{/each}
				</fieldset>
			{/each}
			<div class="grid justify-items-start gap-s-1">
				<button
					type="submit"
					class="button-primary"
					data-testid="benchmark-submit"
					disabled={!complete}
				>
					{m.benchmark_submit()}
				</button>
				{#if !complete}
					<p class="caption text-ink-2">{m.benchmark_submit_hint()}</p>
				{/if}
			</div>
		</form>
	{:else if snap.result}
		<h2 class="title" tabindex="-1" bind:this={heading}>{m.benchmark_result_title()}</h2>
		<div class="mt-s-3 grid gap-s-3 sm:grid-cols-2">
			<div>
				<p class="label text-ink-2">{m.benchmark_wpm_label()}</p>
				<p class="figure">
					<span data-testid="benchmark-wpm">{formatNumber(snap.result.wpm)}</span>
					<span class="figure-unit">{m.benchmark_wpm_unit()}</span>
				</p>
			</div>
			<div>
				<p class="label text-ink-2">{m.benchmark_comprehension_label()}</p>
				<p class="figure">
					<span data-testid="benchmark-comprehension">{snap.result.comprehension}</span>
					<span class="figure-unit">%</span>
				</p>
				<p class="label mt-s-1" data-testid="benchmark-correct">
					{m.benchmark_correct({ correct: snap.result.correct, total: snap.result.questions })}
				</p>
			</div>
		</div>
		<p class="lead mt-s-3 max-w-[52ch]" data-testid="benchmark-standing">
			{standing === "below"
				? m.benchmark_standing_below()
				: standing === "above"
					? m.benchmark_standing_above()
					: m.benchmark_standing_within()}
		</p>
		<p class="caption mt-s-2 max-w-[52ch] text-ink-2">{m.benchmark_result_note()}</p>
		{#if error}
			<p role="alert" class="label mt-s-2 text-red-ink">{error}</p>
		{:else if saved}
			<p class="caption mt-s-2 text-ink-2" data-testid="benchmark-saved">{m.benchmark_saved()}</p>
		{/if}
		<div class="mt-s-3 flex flex-wrap items-center gap-s-2">
			<button type="button" class="button-primary" data-testid="benchmark-again" onclick={again}>
				{m.benchmark_again()}
			</button>
			<a class="underline" href={localizeHref("/reader")}>{m.benchmark_read_now()}</a>
		</div>
	{/if}

	{#if snap.phase === "intro" || snap.phase === "results"}
		<section class="mt-s-5" aria-labelledby="benchmark-results-title" data-testid="benchmark-trend">
			<h2 id="benchmark-results-title" class="title">{m.benchmark_results_title()}</h2>
			<div class="rule-heavy mt-s-2 pt-s-2">
				{#if trend && trend.count > 0}
					<p class="label" data-testid="benchmark-count">
						{m.benchmark_results_count({ count: formatNumber(trend.count) })}
					</p>
					<div class="mt-s-2">
						<SpeedChart
							points={trend.points}
							label={m.benchmark_results_label({
								count: trend.points.length,
								latest: trend.points[trend.points.length - 1]?.wpm ?? 0,
							})}
						/>
						<p class="caption mt-s-1 text-ink-2">{m.benchmark_results_chart_note()}</p>
					</div>
					<table class="mt-s-3 w-full border-collapse text-left">
						<caption class="sr-only">{m.benchmark_results_title()}</caption>
						<thead>
							<tr>
								<th scope="col" class="caption py-s-1 pr-s-2">{m.benchmark_col_date()}</th>
								<th scope="col" class="caption py-s-1 pr-s-2 text-right">{m.benchmark_col_wpm()}</th>
								<th scope="col" class="caption py-s-1 text-right">{m.benchmark_col_comprehension()}</th>
							</tr>
						</thead>
						<tbody>
							{#each trend.rows as row (row.id)}
								<tr class="border-t-2 border-rule" data-testid="benchmark-row">
									<td class="py-s-1 pr-s-2">{date(row.date)}</td>
									<td class="py-s-1 pr-s-2 text-right">{row.wpm}</td>
									<td class="py-s-1 text-right">{row.comprehension}%</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else if trend}
					<p class="caption text-ink-2" data-testid="benchmark-empty">{m.benchmark_results_empty()}</p>
				{/if}
				<p class="caption mt-s-2 text-ink-2">{m.benchmark_results_note()}</p>
			</div>
		</section>
	{/if}
</div>

<style>
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-s-1) var(--spacing-s-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* The passage is set for reading: a measure of about 60 characters, open leading. */
	.passage {
		max-width: 60ch;
		font-size: 1.25rem;
		line-height: 1.7;
	}

	.passage p + p {
		margin-top: var(--spacing-s-2);
	}

	/* Done stays in reach at the foot of the screen while the passage scrolls. */
	.done-bar {
		position: sticky;
		bottom: 0;
		display: grid;
		justify-items: start;
		gap: var(--spacing-s-1);
		margin-top: var(--spacing-s-4);
		padding-block: var(--spacing-s-2);
		background: var(--color-paper);
		border-top: 2px solid var(--color-ink);
	}

	/* An answer is a bordered row; the checked one fills like a pressed segment. */
	.option {
		display: flex;
		align-items: center;
		gap: var(--spacing-s-1);
		min-height: 44px;
		padding: var(--spacing-s-1) var(--spacing-s-2);
		border: 2px solid var(--color-ink);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.option:hover {
		background: var(--color-paper-2);
	}

	.option:has(input:checked) {
		background: var(--color-pressed);
		color: var(--color-on-pressed);
	}

	.option:has(input:focus-visible) {
		outline: 3px solid var(--color-ink);
		outline-offset: 2px;
	}

	.option input {
		flex: none;
		width: 1.25rem;
		height: 1.25rem;
		accent-color: currentColor;
	}

	h2:focus {
		outline: none;
	}

	.figure {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: var(--spacing-s-1);
		margin: 0;
		font-size: clamp(4.5rem, 3.5rem + 5vw, 8rem);
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
