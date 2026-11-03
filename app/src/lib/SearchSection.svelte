<script lang="ts">
import type { Snippet } from "svelte";

// One titled section of a search page: a heavy rule, the heading against the axis, and the
// text to its right. Text stays within a readable line length.
let { title, children }: { title: string; children: Snippet } = $props();
</script>

<div class="rule-heavy mx-gutter"></div>
<section class="poster pt-s-4 pb-s-4">
	<h2 class="title poster-head">{title}</h2>
	<div class="max-w-[60ch] space-y-s-2">
		{@render children()}
	</div>
</section>
