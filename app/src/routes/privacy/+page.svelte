<script lang="ts">
import { say } from "#lib/learn/say.ts";
import DataTable from "#lib/legal/DataTable.svelte";
import { plusFigures } from "#lib/legal/figures.ts";
import LegalSection from "#lib/legal/LegalSection.svelte";
import LegalStatus from "#lib/legal/LegalStatus.svelte";
import { PLAY_ROWS, PROCESSORS, RETENTION_ROWS } from "#lib/legal/tables.ts";
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import Seo from "#lib/Seo.svelte";

// A table cell's message is named by its row and column, and a test checks every one exists.
const figures = plusFigures();
const email = m.legal_contact_email();

const sections = $derived([
	{ id: "controller", title: m.privacy_controller_title() },
	{ id: "reading", title: m.privacy_reading_title() },
	{ id: "account", title: m.privacy_account_title() },
	{ id: "sync", title: m.privacy_sync_title() },
	{ id: "voices", title: m.privacy_voices_title() },
	{ id: "analytics", title: m.privacy_analytics_title() },
	{ id: "newsletter", title: m.privacy_newsletter_title() },
	{ id: "payments", title: m.privacy_payments_title() },
	{ id: "companies", title: m.privacy_proc_title() },
	{ id: "keep", title: m.privacy_keep_title() },
	{ id: "rights", title: m.privacy_rights_title() },
	{ id: "play", title: m.privacy_play_title() },
	{ id: "extension", title: m.privacy_extension_title() },
]);

const processorRows = PROCESSORS.map((processor) => ({
	head: processor.name,
	cells: ["why", "data", "where"].map((part) =>
		say(`privacy_proc_${processor.id}_${part}`),
	),
}));
const keepRows = RETENTION_ROWS.map((id) => ({
	head: say(`privacy_keep_${id}_data`),
	cells: [say(`privacy_keep_${id}_kept`)],
}));
const playRows = PLAY_ROWS.map((id) => ({
	head: say(`privacy_play_${id}_category`),
	cells: [say(`privacy_play_${id}_declared`)],
}));
</script>

<Seo title={m.privacy_title()} description={m.privacy_description()} path="/privacy" />

<section class="poster pt-s-6 pb-s-5">
	<h1 class="headline poster-head enter">{m.privacy_headline()}</h1>
	<div class="space-y-s-3">
		<p class="lead max-w-[34ch]">{m.privacy_lead()}</p>
		<LegalStatus />
		<nav aria-label={m.legal_on_page()}>
			<p class="label text-ink-2">{m.legal_on_page()}</p>
			<ul class="label columns-1 gap-s-4 sm:columns-2">
				{#each sections as section (section.id)}
					<li><a class="inline-flex min-h-11 items-center underline" href="#{section.id}">{section.title}</a></li>
				{/each}
			</ul>
		</nav>
	</div>
</section>

<LegalSection id="short" title={m.privacy_short_title()}>
	<p class="lead">{m.privacy_short()}</p>
</LegalSection>

<LegalSection id="controller" title={m.privacy_controller_title()}>
	<p>
		{m.privacy_controller_before()}
		<a href="mailto:{email}">{email}</a>{m.privacy_controller_after()}
	</p>
	<p>
		{m.privacy_terms_before()}
		<a href={localizeHref("/terms")}>{m.privacy_terms_link()}</a>{m.privacy_terms_after()}
	</p>
</LegalSection>

<LegalSection id="reading" title={m.privacy_reading_title()}>
	<p>{m.privacy_reading_text()}</p>
</LegalSection>

<LegalSection id="account" title={m.privacy_account_title()}>
	<p>{m.privacy_account_sign_in()}</p>
	<p>{m.privacy_account_collected()}</p>
</LegalSection>

<LegalSection id="sync" title={m.privacy_sync_title()}>
	<p>{m.privacy_sync_text({ sync: figures.sync })}</p>
	<p>{m.privacy_sync_consent_intro()}</p>
	<blockquote class="space-y-s-1 border-l-4 border-ink pl-s-2">
		<p class="label">{m.privacy_sync_consent_head()}</p>
		<p>{m.privacy_sync_consent_lead()}</p>
		<ul class="list-disc space-y-s-1 pl-s-3">
			<li>{m.privacy_sync_consent_stored()}</li>
			<li>{m.privacy_sync_consent_files()}</li>
			<li>{m.privacy_sync_consent_history()}</li>
			<li>{m.privacy_sync_consent_device({ sync: figures.sync })}</li>
			<li>{m.privacy_sync_consent_off()}</li>
		</ul>
		<p class="label">{m.privacy_sync_consent_buttons()}</p>
	</blockquote>
</LegalSection>

<LegalSection id="voices" title={m.privacy_voices_title()}>
	<p>{m.privacy_voices_text()}</p>
	<blockquote class="space-y-s-1 border-l-4 border-ink pl-s-2">
		<p class="label">{m.privacy_voices_consent_head()}</p>
		<p>{m.privacy_voices_consent_text()}</p>
		<p class="label">{m.privacy_voices_consent_buttons()}</p>
	</blockquote>
	<p>{m.privacy_voices_not_now()}</p>
</LegalSection>

<LegalSection id="analytics" title={m.privacy_analytics_title()}>
	<p>{m.privacy_analytics_lead()}</p>
	<p>
		<a class="label" href={localizeHref("/privacy/events")}>{m.privacy_analytics_events_link()}</a>
	</p>
	<p>{m.privacy_analytics_visit()}</p>
	<p>{m.privacy_analytics_feedback()}</p>
</LegalSection>

<LegalSection id="newsletter" title={m.privacy_newsletter_title()}>
	<p>{m.privacy_newsletter_text()}</p>
	<p>{m.privacy_newsletter_erase()}</p>
</LegalSection>

<LegalSection id="payments" title={m.privacy_payments_title()}>
	<p>{m.privacy_payments_text()}</p>
	<p>{m.privacy_payments_cookies()}</p>
</LegalSection>

<LegalSection id="companies" title={m.privacy_proc_title()}>
	<p>{m.privacy_proc_intro()}</p>
	<DataTable
		id="processors"
		caption={m.privacy_proc_caption()}
		columns={[
			m.privacy_cols_company(),
			m.privacy_cols_why(),
			m.privacy_cols_handles(),
			m.privacy_cols_where(),
		]}
		rows={processorRows}
	/>
</LegalSection>

<LegalSection id="keep" title={m.privacy_keep_title()}>
	<DataTable
		caption={m.privacy_keep_caption()}
		columns={[m.privacy_keep_col_data(), m.privacy_keep_col_kept()]}
		rows={keepRows}
	/>
</LegalSection>

<LegalSection id="rights" title={m.privacy_rights_title()}>
	<p>{m.privacy_rights_download()}</p>
	<p>
		{m.privacy_rights_delete_before()}
		<a href={localizeHref("/account/delete")}>{m.privacy_rights_delete_path()}</a>
		{m.privacy_rights_delete_after()}
	</p>
	<p>
		{m.privacy_rights_write_before()}
		<a href="mailto:{email}">{email}</a>
		{m.privacy_rights_write_after()}
	</p>
</LegalSection>

<LegalSection id="play" title={m.privacy_play_title()}>
	<p>{m.privacy_play_text()}</p>
	<DataTable
		caption={m.privacy_play_caption()}
		columns={[m.privacy_play_col_category(), m.privacy_play_col_declared()]}
		rows={playRows}
	/>
	<p>{m.privacy_play_shared()}</p>
	<p>
		{m.privacy_play_delete_before()}
		<a href={localizeHref("/account/delete")}>{m.privacy_rights_delete_path()}</a>{m.privacy_play_delete_after()}
	</p>
</LegalSection>

<LegalSection id="extension" title={m.privacy_extension_title()}>
	<p>{m.privacy_extension_text()}</p>
	<p>{m.privacy_extension_tab()}</p>
	<p>{m.privacy_extension_local()}</p>
</LegalSection>
