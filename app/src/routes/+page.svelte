<script lang="ts">
import PasteBox from "#lib/PasteBox.svelte";
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import { handOff } from "#lib/reader/handoff.ts";
import type { ReaderSource } from "#lib/reader/open.ts";
import Seo from "#lib/Seo.svelte";
import { goto } from "$app/navigation";

// The text goes to /reader through memory, not through the URL.
function start(source: ReaderSource) {
	handOff(source);
	void goto(localizeHref("/reader"));
}
</script>

<Seo title={m.home_title()} description={m.home_description()} path="/" />

<section class="poster pt-s-7 pb-s-6">
	<h1 class="headline poster-head enter">{m.home_headline()}</h1>
	<div>
		<p class="lead max-w-[30ch]">{m.home_lead()}</p>
		<div class="mt-s-4 max-w-[40rem]">
			<PasteBox onstart={start} />
		</div>
		<p class="mt-s-5">
			<span class="numeral block">{m.hero_speed_value()}</span>
			<span class="caption mt-s-2 block text-ink-2">{m.hero_speed_label()}</span>
		</p>
		<p class="label mt-s-4">
			<a href={localizeHref("/spreeder-alternative")}>{m.home_alternative()}</a>
		</p>
	</div>
</section>
<div class="rule-heavy mx-gutter"></div>
<section class="poster pt-s-5">
	<h2 class="title poster-head">{m.home_facts_title()}</h2>
	<ul class="max-w-[36ch] space-y-s-1">
		<li>{m.home_fact_account()}</li>
		<li>{m.home_fact_local()}</li>
		<li>
			{m.home_fact_open()}
			<a href="https://github.com/sami-29/speeedy">{m.home_source_link()}</a>
		</li>
	</ul>
</section>
