<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { SITE_ORIGIN } from "#lib/seo/site.ts";

// The head tags every public page needs: title, description, canonical link and the tags
// that shape a shared link. Public pages only; app routes carry `noindex` instead.
let {
	title,
	description,
	path,
}: { title: string; description: string; path: string } = $props();

const url = $derived(`${SITE_ORIGIN}${path}`);
const image = `${SITE_ORIGIN}/og-image.png`;
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={m.site_name()} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={url} />
	<meta property="og:image" content={image} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={m.seo_og_alt()} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>
