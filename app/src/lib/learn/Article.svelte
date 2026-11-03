<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import SearchSection from "#lib/SearchSection.svelte";
import Seo from "#lib/Seo.svelte";
import { ARTICLES, type Article, articleSources, HUB } from "./articles.ts";
import ReadingSpeedChart from "./ReadingSpeedChart.svelte";
import { say } from "./say.ts";
import { type Access, SOURCES, type SourceId } from "./sources.ts";

// One /learn article: the head tags, a headline and lead, its sections, the numbered
// sources and links to the rest. Every claim paragraph carries `data-claim` and a source
// mark that goes to its entry in the list at the end.
let { article }: { article: Article } = $props();

const sources = $derived(articleSources(article));
const others = $derived(ARTICLES.filter((item) => item.slug !== article.slug));
const number = (id: SourceId): number => sources.indexOf(id) + 1;

const accessNote = (access: Access): string | undefined =>
	({
		full: undefined,
		abstract: m.learn_refs_access_abstract(),
		highlights: m.learn_refs_access_highlights(),
		review: m.learn_refs_access_review(),
	})[access];
</script>

<Seo
	title={say(`${article.prefix}_title`)}
	description={say(`${article.prefix}_description`)}
	path={article.path}
/>

<section class="poster pt-s-6 pb-s-5">
	<h1 class="headline poster-head enter">{say(`${article.prefix}_headline`)}</h1>
	<div>
		<p class="lead max-w-[34ch]">{say(`${article.prefix}_lead`)}</p>
	</div>
</section>

{#snippet cites(ids: readonly SourceId[])}
	{#each ids as id (id)}
		<a
			class="cite label whitespace-nowrap text-ink-2 no-underline hover:underline"
			href="#ref-{id}"
			aria-label={m.learn_cite_label({
				n: number(id),
				source: `${SOURCES[id].short} ${SOURCES[id].year}`,
			})}>[{number(id)}]</a
		>
	{/each}
{/snippet}

{#each article.sections as section (section.titleKey)}
	<SearchSection title={say(section.titleKey)}>
		{#each section.blocks as block (block.kind === "chart" ? block.captionKey : block.key)}
			{#if block.kind === "claim"}
				<p data-claim>{say(block.key)} {@render cites(block.cite)}</p>
			{:else if block.kind === "chart"}
				<figure class="space-y-s-1">
					<ReadingSpeedChart />
					<figcaption class="caption text-ink-2" data-claim>
						{say(block.captionKey)}
						{@render cites(block.cite)}
					</figcaption>
				</figure>
			{:else}
				<p>
					{say(block.key)}
					{#if block.link}
						<a class="underline" href={localizeHref(block.link.href)}>{say(block.link.labelKey)}</a>
					{/if}
				</p>
			{/if}
		{/each}
	</SearchSection>
{/each}

<SearchSection title={m.learn_refs_title()}>
	<p class="caption text-ink-2">{m.learn_refs_note()}</p>
	<ol id="references" class="list-decimal space-y-s-2 pl-s-3">
		{#each sources as id (id)}
			{@const source = SOURCES[id]}
			<li id="ref-{id}" class="ref scroll-mt-s-3">
				{source.citation}
				<a class="break-all underline" href="https://doi.org/{source.doi}" rel="noopener"
					>https://doi.org/{source.doi}</a
				>
				{#if accessNote(source.access)}
					<span class="caption block text-ink-2">{accessNote(source.access)}</span>
				{/if}
			</li>
		{/each}
	</ol>
</SearchSection>

<SearchSection title={m.learn_related_title()}>
	<ul class="space-y-s-1">
		<li><a class="underline" href={localizeHref(HUB.path)}>{m.learn_all_link()}</a></li>
		{#each others as item (item.slug)}
			<li><a class="underline" href={localizeHref(item.path)}>{say(`${item.prefix}_headline`)}</a></li>
		{/each}
	</ul>
</SearchSection>

<style>
	.ref:target {
		background: var(--color-paper-2);
	}
</style>
