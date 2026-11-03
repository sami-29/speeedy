<script lang="ts">
import { ARTICLES, HUB } from "#lib/learn/articles.ts";
import { say } from "#lib/learn/say.ts";
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import Seo from "#lib/Seo.svelte";
</script>

<Seo title={m.learn_hub_title()} description={m.learn_hub_description()} path={HUB.path} />

<section class="poster pt-s-6 pb-s-5">
	<h1 class="headline poster-head enter">{m.learn_hub_headline()}</h1>
	<div>
		<p class="lead max-w-[34ch]">{m.learn_hub_lead()}</p>
	</div>
</section>

{#each ARTICLES as article (article.slug)}
	<div class="rule-heavy mx-gutter"></div>
	<section class="poster pt-s-4 pb-s-4">
		<h2 class="title poster-head">
			<a class="underline" href={localizeHref(article.path)}>{say(`${article.prefix}_headline`)}</a>
		</h2>
		<div class="max-w-[60ch]">
			<p>{say(`${article.prefix}_summary`)}</p>
		</div>
	</section>
{/each}
