<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import { handOff } from "#lib/reader/handoff.ts";
import { decodeShareHash, isShareHash } from "#lib/share/codec.ts";
import ShareLinkCreator from "#lib/share/ShareLinkCreator.svelte";
import { goto, replaceState } from "$app/navigation";
import { page } from "$app/state";

// The Share Link lives in the fragment, which never reaches a server. This page decodes it
// on the device and hands the text to /reader in memory; /reader replaces this history entry,
// so Back does not reopen the link and the text does not linger in the address bar.
let status = $state<"idle" | "opening" | "malformed" | "too-long">("idle");
// The 2.0 form a 1.x link was rewritten to, so it is not opened a second time.
let rewritten = "";

function read(text: string) {
	handOff({ text, source: "share" });
	void goto(localizeHref("/reader"), { replaceState: true });
}

$effect(() => {
	const hash = page.url.hash;
	let stale = false;
	if (rewritten !== "" && hash === rewritten) return;
	// Only #1. and #/read/ are Share Links; the #main skip link must not touch the creator.
	if (!isShareHash(hash)) {
		status = "idle";
		return;
	}
	status = "opening";
	void decodeShareHash(hash).then((result) => {
		if (stale) return;
		switch (result.kind) {
			case "none":
				status = "idle";
				break;
			case "text":
				read(result.text);
				break;
			case "legacy":
				// A 1.x link is replaced with its 2.0 form (when that fits the cap), then read.
				if (result.payload) {
					rewritten = `#${result.payload}`;
					replaceState(`/s${rewritten}`, {});
				}
				read(result.text);
				break;
			case "error":
				status = result.reason;
				break;
		}
	});
	return () => {
		stale = true;
	};
});
</script>

<svelte:head>
	<title>{m.share_link_label()} - {m.site_name()}</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<section class="poster pt-s-6" aria-labelledby="share-title">
	<h1 id="share-title" class="headline poster-head">{m.share_title()}</h1>
	<div>
		{#if status === "opening"}
			<p class="lead" aria-live="polite">{m.share_opening()}</p>
		{:else if status === "malformed" || status === "too-long"}
			<p role="alert" class="lead text-red-ink">
				{status === "malformed" ? m.share_broken() : m.share_link_too_long()}
			</p>
			<p class="mt-s-3">
				<a class="label inline-flex min-h-11 items-center" href={localizeHref("/reader")}>{m.share_open_reader()}</a>
			</p>
		{:else}
			<p class="lead max-w-[52ch]">{m.share_lead()}</p>
			<div class="mt-s-4">
				<ShareLinkCreator />
			</div>
		{/if}
	</div>
</section>
