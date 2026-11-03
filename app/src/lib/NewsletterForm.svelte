<script lang="ts">
import type { NewsletterPage } from "@speeedy/contracts";
import { type SignupResult, sendSignup } from "#lib/newsletter.ts";
import { m } from "#lib/paraglide/messages.js";

// `compact` is the footer form. `full` is the block for /support, About and the changelog.
let {
	page,
	variant = "compact",
}: { page: NewsletterPage; variant?: "compact" | "full" } = $props();

const uid = $props.id();

let email = $state("");
let building = $state(false);
// The honeypot. Readers never see it, so anything in it came from a bot.
let website = $state("");
let sending = $state(false);
let result = $state<SignupResult | null>(null);

async function submit(event: SubmitEvent) {
	event.preventDefault();
	if (sending) return;
	sending = true;
	result = null;
	result = await sendSignup({ email, building, page, website });
	sending = false;
}
</script>

<div class="newsletter" data-variant={variant}>
	<h2 class={variant === "full" ? "title" : "label"} id="{uid}-heading">{m.newsletter_heading()}</h2>
	<form
		method="post"
		action="/api/newsletter"
		aria-label={m.newsletter_label()}
		onsubmit={submit}
	>
		{#if result !== "sent"}
			<div class="fields">
				<div class="field">
					<label class="label" for="{uid}-email">{m.newsletter_email()}</label>
					<input
						id="{uid}-email"
						class="paste-field"
						type="email"
						name="email"
						autocomplete="email"
						required
						bind:value={email}
					/>
				</div>
				<button class="button-primary compact" type="submit" disabled={sending}>
					{sending ? m.newsletter_sending() : m.newsletter_submit()}
				</button>
			</div>
			<label class="check caption">
				<input type="checkbox" name="building" bind:checked={building} />
				<span>{m.newsletter_building()}</span>
			</label>
			<div class="trap" aria-hidden="true">
				<input
					type="text"
					name="website"
					tabindex="-1"
					autocomplete="off"
					bind:value={website}
				/>
			</div>
			<p class="caption promise">{m.newsletter_promise()}</p>
		{/if}
		<div aria-live="polite">
			{#if result === "sent"}
				<p class="label" role="status">{m.newsletter_done()}</p>
			{/if}
		</div>
		{#if result === "rate_limited" || result === "failed"}
			<p class="label" role="alert">
				{result === "rate_limited" ? m.newsletter_rate_limited() : m.newsletter_failed()}
			</p>
		{/if}
	</form>
</div>

<style>
	.newsletter {
		display: grid;
		gap: var(--spacing-s-2);
	}
	form {
		display: grid;
		gap: var(--spacing-s-2);
		max-width: 56ch;
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--spacing-s-2);
	}
	.field {
		display: grid;
		gap: 4px;
		flex: 1 1 16rem;
	}
	.paste-field {
		min-height: 52px;
		padding: var(--spacing-s-1) var(--spacing-s-2);
		background: var(--color-paper);
		color: var(--color-ink);
		border: 2px solid var(--color-ink);
		border-radius: 0;
		font: inherit;
	}
	.compact {
		min-height: 52px;
		cursor: pointer;
	}
	.compact:disabled {
		background: var(--color-paper-2);
		color: var(--color-ink-3);
		cursor: default;
	}
	.check {
		display: flex;
		align-items: flex-start;
		gap: var(--spacing-s-1);
		min-height: 44px;
		cursor: pointer;
	}
	.check input {
		flex: none;
		width: 24px;
		height: 24px;
		margin: 0;
		accent-color: var(--color-ink);
	}
	.promise {
		color: var(--color-ink-2);
	}
	/* Off the page and out of the tab order, not display: none, which bots skip. */
	.trap {
		position: absolute;
		left: -10000px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
</style>
