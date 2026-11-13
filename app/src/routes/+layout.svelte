<script lang="ts">
import { onMount } from "svelte";
import "../app.css";
import NewsletterForm from "#lib/NewsletterForm.svelte";
import { newsletterPageFor, showsFooterForm } from "#lib/newsletter.ts";
import { m } from "#lib/paraglide/messages.js";
import { deLocalizeUrl, localizeHref } from "#lib/paraglide/runtime.js";
import UpdateNotice from "#lib/pwa/UpdateNotice.svelte";
import { startUpdateWatch } from "#lib/pwa/updates.svelte.ts";
import { startErrorCapture, trackPageview } from "#lib/telemetry.ts";
import { theme } from "#lib/theme.svelte.ts";
import {
	type Appearance,
	applyTheme,
	THEME_COLORS,
	type ThemeFamily,
} from "#lib/theme.ts";
import Wordmark from "#lib/Wordmark.svelte";
import { afterNavigate } from "$app/navigation";
import { page } from "$app/state";

let { children } = $props();

// Uncaught errors are reported by code and stack frames only, never their message.
onMount(startErrorCapture);

// Tell the reader, in a plain line, when a new version of the app is waiting.
onMount(startUpdateWatch);

// One route-only $pageview per page, on first load and on every client-side navigation.
afterNavigate((navigation) =>
	trackPageview(navigation.to?.url.pathname ?? window.location.pathname),
);

const inApp = $derived(page.route.id?.startsWith("/(app)") ?? false);

// The path without a locale prefix or a trailing slash, as the route tables list it.
const path = $derived(
	deLocalizeUrl(page.url).pathname.replace(/(.)\/+$/, "$1"),
);
// Not on a reading surface, and not where the page carries the full block itself.
const showForm = $derived(showsFooterForm(path));

// App routes follow the saved theme and, unless the reader chose, the system's light or
// dark; public pages are always Paper in light. Switching only changes two attributes on the
// root, so nothing reloads and the reader keeps its place.
$effect(() => {
	const family = inApp ? theme.family : "paper";
	const scheme = inApp ? theme.scheme : "light";
	applyTheme(document.documentElement, family, scheme);
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute("content", THEME_COLORS[family][scheme]);
});

const nav = $derived([
	{ href: "/reader", label: m.nav_reader(), essential: false },
	{ href: "/library", label: m.nav_library(), essential: true },
	{ href: "/stats", label: m.nav_stats(), essential: false },
	{ href: "/training", label: m.nav_training(), essential: false },
]);

const families = $derived<{ id: ThemeFamily; label: string }[]>([
	{ id: "paper", label: m.theme_paper() },
	{ id: "classic", label: m.theme_classic() },
	{ id: "cozy", label: m.theme_cozy() },
]);

const appearances = $derived<{ id: Appearance; label: string }[]>([
	{ id: "system", label: m.theme_system() },
	{ id: "light", label: m.theme_light() },
	{ id: "dark", label: m.theme_dark() },
]);
</script>

<a
	class="absolute left-gutter top-s-1 z-10 -translate-y-24 bg-ink px-s-2 py-s-1 text-paper focus:translate-y-0"
	href="#main">{m.skip_to_content()}</a
>

<header class="flex flex-wrap items-center justify-between gap-x-s-2 px-gutter py-s-2">
	<a href={localizeHref("/")} class="wordmark inline-flex min-h-11 items-center" aria-label={m.site_name()}>
		<Wordmark />
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
			<button
				type="button"
				class="segment border-2 border-ink"
				popovertarget="theme-picker">{m.theme_button()}</button
			>
			<!-- No display class on the popover itself: it would beat the rule that hides it. -->
			<div id="theme-picker" popover class="picker border-2 border-ink bg-paper p-s-3">
				<div class="grid gap-s-3">
				<fieldset class="grid gap-s-1">
					<legend class="caption mb-s-1 text-ink-2">{m.theme_family_legend()}</legend>
					{#each families as item (item.id)}
						<label class="choice label">
							<input
								type="radio"
								name="theme-family"
								value={item.id}
								checked={theme.family === item.id}
								onchange={() => theme.setFamily(item.id)}
							/>
							{item.label}
						</label>
					{/each}
				</fieldset>
				<fieldset class="grid gap-s-1">
					<legend class="caption mb-s-1 text-ink-2">{m.theme_appearance_legend()}</legend>
					{#each appearances as item (item.id)}
						<label class="choice label">
							<input
								type="radio"
								name="theme-appearance"
								value={item.id}
								checked={theme.appearance === item.id}
								onchange={() => theme.setAppearance(item.id)}
							/>
							{item.label}
						</label>
					{/each}
				</fieldset>
				</div>
			</div>
		{/if}
	</div>
</header>

<main id="main" class="poster-axis pb-s-6">
	{@render children()}
</main>

<UpdateNotice />

{#if showForm}
	<footer class="rule-heavy mt-s-5 poster px-gutter py-s-4">
		<div class="poster-head"></div>
		<div class="grid gap-s-3">
			<NewsletterForm page={newsletterPageFor(path)} />
			<p class="caption text-ink-3">{m.newsletter_address()}</p>
		</div>
	</footer>
{/if}

<style>
	/* A popover sits in the top layer, so it is placed against the viewport: under the
	   header, on the right edge, like a menu dropped from the toggle. */
	.picker {
		inset: auto;
		top: 4.5rem;
		right: var(--spacing-gutter);
		margin: 0;
		min-width: 14rem;
		border-radius: var(--radius-control);
		color: var(--color-ink);
	}

	.choice {
		display: flex;
		align-items: center;
		gap: var(--spacing-s-1);
		min-height: 44px;
		cursor: pointer;
	}

	/* Drawn from the tokens, as the checkboxes are: the browser's own radio is a flat
	   grey in dark schemes. */
	.choice input {
		appearance: none;
		flex: none;
		width: 1.25rem;
		height: 1.25rem;
		margin: 0;
		border: 2px solid var(--color-ink-3);
		border-radius: 50%;
		background: var(--color-paper);
		cursor: pointer;
	}

	.choice input:checked {
		border-color: var(--color-accent);
		background: radial-gradient(
			var(--color-accent) 0 42%,
			var(--color-paper) 46%
		);
	}
</style>
