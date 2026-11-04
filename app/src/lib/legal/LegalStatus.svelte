<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { LAWYER_REVIEW_PENDING } from "./status.ts";

// The note that marks a legal page as a draft until the lawyer has reviewed it. It is plain
// text in the page, not a banner, and it goes away when the review is done.
</script>

{#if LAWYER_REVIEW_PENDING}
	<p class="label max-w-[60ch] border-l-4 border-red pl-s-2" data-status="awaiting-lawyer-review">
		{m.legal_status()}
	</p>
{/if}
