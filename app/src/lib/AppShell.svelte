<script lang="ts">
import { m } from "#lib/paraglide/messages.js";

let { title, name }: { title: string; name: string } = $props();
</script>

<svelte:head>
	<title>{name} - {m.site_name()}</title>
</svelte:head>

<div class="poster pt-s-6">
	<h1 class="headline poster-head">{title}</h1>
	<p class="lead max-w-[52ch]">{m.app_shell_note()}</p>
</div>
