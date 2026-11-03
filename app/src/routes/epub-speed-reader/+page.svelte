<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import SearchPage from "#lib/SearchPage.svelte";
import SearchSection from "#lib/SearchSection.svelte";
</script>

<SearchPage
	path="/epub-speed-reader"
	title={m.epub_title()}
	description={m.epub_description()}
	headline={m.epub_headline()}
	lead={m.epub_lead()}
>
	<SearchSection title={m.epub_opens_title()}>
		<p>{m.epub_opens_text()}</p>
		<ul class="list-disc space-y-s-1 pl-s-3">
			<li>{m.epub_opens_skipped()}</li>
			<li>{m.epub_opens_jump()}</li>
		</ul>
	</SearchSection>
	<SearchSection title={m.epub_drm_title()}>
		<p>{m.epub_drm_text()}</p>
	</SearchSection>
	<SearchSection title={m.epub_place_title()}>
		<p>{m.epub_place_text()}</p>
		<p>{m.epub_place_private()}</p>
	</SearchSection>
	<SearchSection title={m.epub_other_title()}>
		<p>{m.epub_other_text()}</p>
	</SearchSection>
</SearchPage>
