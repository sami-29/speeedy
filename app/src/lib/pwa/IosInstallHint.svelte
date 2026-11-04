<script lang="ts">
import { onMount } from "svelte";
import { m } from "#lib/paraglide/messages.js";
import { showsIosInstallHint } from "./ios.ts";

// Safari on iOS has no install prompt, so this is one plain sentence saying how to do it by
// hand. It appears after mount (the page is prerendered, so it cannot know the browser) and
// never as a popup.
let show = $state(false);

onMount(() => {
	show = showsIosInstallHint({
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		maxTouchPoints: navigator.maxTouchPoints,
		standalone:
			(navigator as Navigator & { standalone?: boolean }).standalone === true,
	});
});
</script>

{#if show}
	<p class="caption mt-s-2 text-ink-2">{m.pwa_ios_install()}</p>
{/if}
