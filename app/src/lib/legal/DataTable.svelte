<script lang="ts">
import { inlineParts } from "./event-list.ts";

// A plain table for the legal pages: heavy rule above, hairlines between rows, the first
// cell of each row a row header. Text in backticks is set as code. Under 640px each row
// stacks and every cell carries its column name, so the table never scrolls sideways.
let {
	id,
	caption,
	columns,
	rows,
}: {
	id?: string;
	/** Names the table for assistive technology; it is not drawn. */
	caption: string;
	columns: readonly string[];
	rows: readonly { head: string; cells: readonly string[] }[];
} = $props();
</script>

{#snippet text(value: string)}
	{#each inlineParts(value) as part, index (index)}
		{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}
	{/each}
{/snippet}

<table {id} class="data">
	<caption class="sr-only">{caption}</caption>
	<thead class="sr-only-narrow">
		<tr>
			{#each columns as column (column)}
				<th scope="col" class="label">{column}</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{#each rows as row (row.head)}
			<tr>
				<th scope="row" data-label={columns[0]}>{@render text(row.head)}</th>
				{#each row.cells as cell, index (index)}
					<td data-label={columns[index + 1]}>{@render text(cell)}</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.data {
		width: 100%;
		border-collapse: collapse;
		border-top: 2px solid var(--color-ink);
		font-size: 0.9375rem;
		line-height: 1.5;
	}
	.data :global(th),
	.data td {
		padding: var(--spacing-s-1) var(--spacing-s-2) var(--spacing-s-1) 0;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--color-rule);
		overflow-wrap: anywhere;
	}
	.data tbody th,
	.data thead th {
		overflow-wrap: normal;
		min-width: 6.5rem;
	}
	.data tbody th {
		font-weight: 650;
	}
	.data thead th {
		color: var(--color-ink-2);
	}
	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.875em;
		overflow-wrap: anywhere;
	}
	@media (max-width: 640px) {
		.sr-only-narrow {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.data,
		.data tbody,
		.data tr,
		.data tbody th,
		.data td {
			display: block;
			width: 100%;
		}
		.data tbody tr {
			padding-block: var(--spacing-s-1);
			border-bottom: 1px solid var(--color-rule);
		}
		.data tbody th,
		.data td {
			border-bottom: 0;
			padding: 2px 0;
		}
		.data td::before {
			content: attr(data-label);
			display: block;
			font-size: 0.8125rem;
			font-weight: 600;
			color: var(--color-ink-2);
		}
	}
</style>
