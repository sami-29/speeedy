<script lang="ts">
import type { Snippet } from "svelte";
import PasteBox from "#lib/PasteBox.svelte";
import type { ReaderPreset } from "#lib/reader/settings.ts";
import { startReader } from "#lib/reader/start.ts";
import Seo from "#lib/Seo.svelte";

// The frame every search page shares: the head tags, a headline, a lead, the paste and drop
// box that opens /reader, and then the sections only that page has. The sections go in as
// children, each one a `SearchSection`.
let {
	path,
	title,
	description,
	headline,
	lead,
	note,
	preset,
	children,
}: {
	path: string;
	title: string;
	description: string;
	headline: string;
	lead: string;
	/** A line under the box, for what Start will do on this page. */
	note?: string;
	/** A reader preset Start asks for. */
	preset?: ReaderPreset;
	children: Snippet;
} = $props();
</script>

<Seo {title} {description} {path} />

<section class="poster pt-s-6 pb-s-5">
	<h1 class="headline poster-head enter">{headline}</h1>
	<div>
		<p class="lead max-w-[34ch]">{lead}</p>
		<div class="mt-s-4 max-w-[40rem]">
			<PasteBox onstart={(source) => startReader(source, preset)} />
			{#if note}
				<p class="caption mt-s-2 text-ink-2">{note}</p>
			{/if}
		</div>
	</div>
</section>

{@render children()}
