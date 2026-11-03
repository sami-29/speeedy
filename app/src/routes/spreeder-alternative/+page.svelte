<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import SearchPage from "#lib/SearchPage.svelte";
import SearchSection from "#lib/SearchSection.svelte";
</script>

<SearchPage
	path="/spreeder-alternative"
	title={m.spreeder_title()}
	description={m.spreeder_description()}
	headline={m.spreeder_headline()}
	lead={m.spreeder_lead()}
>
	<SearchSection title={m.spreeder_vendor_title()}>
		<p class="label">{m.spreeder_vendor_date()}</p>
		<ul class="list-disc space-y-s-1 pl-s-3">
			<li>{m.spreeder_vendor_free()}</li>
			<li>{m.spreeder_vendor_full()}</li>
			<li>{m.spreeder_vendor_maker()}</li>
		</ul>
		<p>{m.spreeder_vendor_price()}</p>
		<ul class="label space-y-s-1">
			<li>
				<a class="underline" href="https://www.spreeder.com/app.html" rel="noopener">{m.spreeder_vendor_app_link()}</a>
			</li>
			<li>
				<a class="underline" href="https://www.spreeder.com/" rel="noopener">{m.spreeder_vendor_home_link()}</a>
			</li>
		</ul>
	</SearchSection>
	<SearchSection title={m.spreeder_speeedy_title()}>
		<ul class="list-disc space-y-s-1 pl-s-3">
			<li>{m.spreeder_speeedy_limit()}</li>
			<li>{m.spreeder_speeedy_formats()}</li>
			<li>{m.spreeder_speeedy_account()}</li>
			<li>{m.spreeder_speeedy_local()}</li>
			<li>
				{m.spreeder_speeedy_open()}
				<a class="underline" href="https://github.com/sami-29/speeedy">{m.home_source_link()}</a>
			</li>
		</ul>
		<p>{m.spreeder_speeedy_pledge()}</p>
		<p class="caption text-ink-2">{m.spreeder_unaffiliated()}</p>
	</SearchSection>
</SearchPage>
