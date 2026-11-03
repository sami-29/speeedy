<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
</script>

<svelte:head>
	<title>{m.hero_title()}</title>
	<meta name="description" content={m.hero_lead()} />
</svelte:head>

<section class="poster pt-s-7 pb-s-6">
	<h1 class="headline poster-head enter">{m.hero_headline()}</h1>
	<div>
		<p class="lead max-w-[30ch]">{m.hero_lead()}</p>
		<p class="mt-s-5">
			<span class="numeral block">{m.hero_speed_value()}</span>
			<span class="caption mt-s-2 block text-ink-2">{m.hero_speed_label()}</span>
		</p>
		<a class="button-primary mt-s-4" href={localizeHref("/reader")}>{m.hero_cta()}</a>
	</div>
</section>
<div class="rule-heavy mx-gutter"></div>
