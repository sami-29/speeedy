<script lang="ts">
import DataTable from "#lib/legal/DataTable.svelte";
import { inlineParts, publishedEventList } from "#lib/legal/event-list.ts";
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import Seo from "#lib/Seo.svelte";

// Generated from the event registry at build time. Nothing on this page names an event.
const list = publishedEventList();
const columns = [
	m.events_col_property(),
	m.events_col_value(),
	m.events_col_required(),
];
</script>

<Seo title={m.events_title()} description={m.events_description()} path="/privacy/events" />

<section class="poster pt-s-6 pb-s-5">
	<h1 class="headline poster-head enter">{m.events_headline()}</h1>
	<div class="space-y-s-3">
		{#each list.intro as paragraph, index (index)}
			<p class="lead max-w-[34ch]">{paragraph}</p>
		{/each}
		<p class="max-w-[60ch]">{m.events_note()}</p>
		<p class="max-w-[60ch]">
			{m.events_policy_before()}
			<a class="underline" href={localizeHref("/privacy")}>{m.events_policy_link()}</a>{m.events_policy_after()}
		</p>
	</div>
</section>

{#each list.events as event (event.name)}
	<div class="rule-heavy mx-gutter"></div>
	<section class="poster pt-s-4 pb-s-4" data-event={event.name}>
		<h2 class="title poster-head [overflow-wrap:anywhere]">{event.name}</h2>
		<div class="space-y-s-2">
			{#each event.paragraphs as paragraph, index (index)}
				<p class="max-w-[60ch]">
					{#each inlineParts(paragraph) as part, partIndex (partIndex)}
						{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}
					{/each}
				</p>
			{/each}
			{#if event.props.length > 0}
				<DataTable
					caption="{event.name} {m.events_table_suffix()}"
					{columns}
					rows={event.props.map((prop) => ({
						head: `\`${prop.name}\``,
						cells: [prop.value, prop.required ? "yes" : "no"],
					}))}
				/>
			{/if}
		</div>
	</section>
{/each}
