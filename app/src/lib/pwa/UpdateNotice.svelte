<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { applyUpdate, updates } from "./updates.svelte.ts";
</script>

<div role="status">
	{#if updates.ready}
		<div class="poster pt-s-3">
			<span class="poster-head"></span>
			<p class="label flex flex-wrap items-center gap-s-2">
				{m.pwa_update_ready()}
				<button type="button" class="segment border-2 border-ink" onclick={applyUpdate}>
					{m.pwa_update_apply()}
				</button>
			</p>
		</div>
	{/if}
</div>
