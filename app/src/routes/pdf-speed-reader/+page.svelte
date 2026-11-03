<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import SearchPage from "#lib/SearchPage.svelte";
import SearchSection from "#lib/SearchSection.svelte";
</script>

<SearchPage
	path="/pdf-speed-reader"
	title={m.pdf_title()}
	description={m.pdf_description()}
	headline={m.pdf_headline()}
	lead={m.pdf_lead()}
>
	<SearchSection title={m.pdf_opens_title()}>
		<p>{m.pdf_opens_text()}</p>
		<ul class="list-disc space-y-s-1 pl-s-3">
			<li>{m.pdf_opens_furniture()}</li>
			<li>{m.pdf_opens_hyphens()}</li>
			<li>{m.pdf_opens_images()}</li>
		</ul>
	</SearchSection>
	<SearchSection title={m.pdf_scan_title()}>
		<p>{m.pdf_scan_text()}</p>
		<p>{m.pdf_scan_todo()}</p>
	</SearchSection>
	<SearchSection title={m.pdf_locked_title()}>
		<p>{m.pdf_locked_text()}</p>
	</SearchSection>
	<SearchSection title={m.pdf_limits_title()}>
		<p>{m.pdf_limits_text()}</p>
	</SearchSection>
	<SearchSection title={m.pdf_course_title()}>
		<p>{m.pdf_course_text()}</p>
	</SearchSection>
</SearchPage>
