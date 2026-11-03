<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import SearchPage from "#lib/SearchPage.svelte";
import SearchSection from "#lib/SearchSection.svelte";
</script>

<SearchPage
	path="/text-to-speech-reader"
	title={m.tts_title()}
	description={m.tts_description()}
	headline={m.tts_headline()}
	lead={m.tts_lead()}
>
	<SearchSection title={m.tts_device_title()}>
		<p>{m.tts_device_body()}</p>
		<p>{m.tts_device_offline()}</p>
		<p>{m.tts_device_timing()}</p>
		<p>{m.tts_device_slow()}</p>
	</SearchSection>
	<SearchSection title={m.tts_browser_title()}>
		<p>{m.tts_browser_body()}</p>
	</SearchSection>
	<SearchSection title={m.tts_cache_title()}>
		<p>{m.tts_cache_body()}</p>
	</SearchSection>
</SearchPage>
