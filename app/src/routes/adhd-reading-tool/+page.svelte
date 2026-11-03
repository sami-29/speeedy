<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import SearchPage from "#lib/SearchPage.svelte";
import SearchSection from "#lib/SearchSection.svelte";
</script>

<SearchPage
	path="/adhd-reading-tool"
	title={m.adhd_title()}
	description={m.adhd_description()}
	headline={m.adhd_headline()}
	lead={m.adhd_lead()}
	note={m.adhd_preset_note()}
	preset="focus"
>
	<SearchSection title={m.adhd_study_title()}>
		<p>{m.adhd_study_text()}</p>
		<p>{m.adhd_study_result()}</p>
		<p>{m.adhd_study_pacing()}</p>
	</SearchSection>
	<SearchSection title={m.adhd_limits_title()}>
		<ul class="list-disc space-y-s-1 pl-s-3">
			<li>{m.adhd_limit_size()}</li>
			<li>{m.adhd_limit_online()}</li>
			<li>{m.adhd_limit_items()}</li>
			<li>{m.adhd_limit_recruit()}</li>
			<li>{m.adhd_limit_scope()}</li>
			<li>{m.adhd_limit_you()}</li>
			<li>{m.adhd_limit_ours()}</li>
		</ul>
	</SearchSection>
	<SearchSection title={m.adhd_preset_title()}>
		<p>{m.adhd_preset_text()}</p>
	</SearchSection>
	<SearchSection title={m.adhd_tweak_title()}>
		<p>{m.adhd_tweak_text()}</p>
	</SearchSection>
</SearchPage>
