<script lang="ts">
import type { Snippet } from "svelte";

// One titled section of a legal page, like a search page section but with an anchor: other
// pages and the store listings link to `#<id>`. Prose keeps a readable line length; tables
// use the full column.
let { id, title, children }: { id: string; title: string; children: Snippet } =
	$props();
</script>

<div class="rule-heavy mx-gutter"></div>
<section {id} class="poster pt-s-4 pb-s-4 scroll-mt-s-2">
	<h2 class="title poster-head">{title}</h2>
	<div class="body space-y-s-2">
		{@render children()}
	</div>
</section>

<style>
	.body > :global(p),
	.body > :global(ul),
	.body > :global(blockquote),
	.body > :global(h3) {
		max-width: 60ch;
	}
	.body :global(a) {
		text-decoration: underline;
	}
</style>
