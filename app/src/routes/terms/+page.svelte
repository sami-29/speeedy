<script lang="ts">
import { plusFigures } from "#lib/legal/figures.ts";
import LegalSection from "#lib/legal/LegalSection.svelte";
import LegalStatus from "#lib/legal/LegalStatus.svelte";
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import Seo from "#lib/Seo.svelte";

const figures = plusFigures();
const email = m.legal_contact_email();
</script>

<Seo title={m.terms_title()} description={m.terms_description()} path="/terms" />

<section class="poster pt-s-6 pb-s-5">
	<h1 class="headline poster-head enter">{m.terms_headline()}</h1>
	<div class="space-y-s-3">
		<p class="lead max-w-[34ch]">{m.terms_lead()}</p>
		<LegalStatus />
	</div>
</section>

<LegalSection id="who" title={m.terms_who_title()}>
	<p>
		{m.terms_who_before()}
		<a href="mailto:{email}">{email}</a>
		{m.terms_who_after()}
		<a href={localizeHref("/privacy")}>{m.terms_who_privacy_link()}</a>{m.terms_who_end()}
	</p>
</LegalSection>

<!-- The Free Pledge and the consent rule are sections of their own, not part of #changes. -->
<LegalSection id="free-pledge" title={m.terms_pledge_title()}>
	<p class="lead">{m.terms_pledge_text()}</p>
	<p>{m.terms_pledge_outside()}</p>
</LegalSection>

<LegalSection id="consent" title={m.terms_consent_title()}>
	<p>{m.terms_consent_text()}</p>
</LegalSection>

<LegalSection id="reading" title={m.terms_reading_title()}>
	<p>{m.terms_reading_text()}</p>
</LegalSection>

<LegalSection id="plus" title={m.terms_plus_title()}>
	<p>{m.terms_plus_price(figures)}</p>
	<p>{m.terms_plus_cancel()}</p>
	<p>{m.terms_plus_refund()}</p>
	<p>{m.terms_plus_voices(figures)}</p>
	<p>{m.terms_plus_change()}</p>
</LegalSection>

<LegalSection id="servers" title={m.terms_servers_title()}>
	<p>{m.terms_servers_text()}</p>
</LegalSection>

<LegalSection id="accounts" title={m.terms_accounts_title()}>
	<p>{m.terms_accounts_text()}</p>
</LegalSection>

<LegalSection id="changes" title={m.terms_changes_title()}>
	<p>{m.terms_changes_text()}</p>
</LegalSection>

<LegalSection id="ending" title={m.terms_ending_title()}>
	<p>{m.terms_ending_text()}</p>
</LegalSection>

<LegalSection id="rules" title={m.terms_rules_title()}>
	<p>{m.terms_rules_use()}</p>
	<p>{m.terms_rules_warranty()}</p>
	<p>{m.terms_rules_consumer()}</p>
</LegalSection>

<LegalSection id="law" title={m.terms_law_title()}>
	<p>{m.terms_law_text()}</p>
</LegalSection>
