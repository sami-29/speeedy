<script lang="ts">
import "../app.css";
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import { theme } from "#lib/theme.svelte.ts";
import { applyTheme, type Theme } from "#lib/theme.ts";
import { page } from "$app/state";

let { children } = $props();

const inApp = $derived(page.route.id?.startsWith("/(app)") ?? false);

// App routes follow the saved theme; public pages are always Paper.
$effect(() => {
	applyTheme(document.documentElement, inApp ? theme.current : "paper");
});

const nav = $derived([
	{ href: "/reader", label: m.nav_reader(), essential: false },
	{ href: "/library", label: m.nav_library(), essential: true },
	{ href: "/stats", label: m.nav_stats(), essential: false },
	{ href: "/training", label: m.nav_training(), essential: false },
]);

const themes = $derived<{ id: Theme; short: string; label: string }[]>([
	{ id: "paper", short: m.theme_paper_short(), label: m.theme_paper() },
	{ id: "night", short: m.theme_night_short(), label: m.theme_night() },
]);
</script>

<a
	class="absolute left-gutter top-s-1 z-10 -translate-y-24 bg-ink px-s-2 py-s-1 text-paper focus:translate-y-0"
	href="#main">{m.skip_to_content()}</a
>

<header class="flex flex-wrap items-center justify-between gap-x-s-2 px-gutter py-s-2">
	<a href={localizeHref("/")} class="wordmark inline-flex min-h-11 items-center" aria-label={m.site_name()}>
		<img class="wordmark-paper" src="/brand/wordmark.svg" width="102" height="28" alt="" />
		<img class="wordmark-night" src="/brand/wordmark-night.svg" width="102" height="28" alt="" />
	</a>
	<div class="flex items-center gap-s-4 max-[860px]:gap-s-2">
		<nav aria-label={m.nav_label()} class="label flex items-center gap-s-4 max-[860px]:gap-s-2">
			{#each nav as item (item.href)}
				<a
					href={localizeHref(item.href)}
					aria-current={page.url.pathname === item.href ? "page" : undefined}
					class="inline-flex min-h-11 items-center no-underline hover:underline aria-[current=page]:underline {item.essential
						? ''
						: 'max-[860px]:hidden'}">{item.label}</a
				>
			{/each}
		</nav>
		{#if inApp}
			<div class="flex border-2 border-ink">
				{#each themes as item (item.id)}
					<button
						type="button"
						class="segment"
						aria-label={item.label}
						aria-pressed={theme.current === item.id}
						onclick={() => theme.set(item.id)}>{item.short}</button
					>
				{/each}
			</div>
		{/if}
	</div>
</header>

<main id="main" class="poster-axis pb-s-6">
	{@render children()}
</main>

<style>
	.wordmark-night {
		display: none;
	}
	:global(:root[data-theme="night"]) .wordmark-paper {
		display: none;
	}
	:global(:root[data-theme="night"]) .wordmark-night {
		display: inline;
	}
</style>
