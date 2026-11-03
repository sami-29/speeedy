import { describe, expect, it } from "vitest";
import { lintSvelte } from "../scripts/lint-runes.ts";

describe("runes lint", () => {
	it("accepts a runes component", () => {
		const source = `<script lang="ts">
	let { label }: { label: string } = $props();
	let count = $state(0);
	const doubled = $derived(count * 2);
</script>
<button onclick={() => count++}>{label} {doubled}</button>`;
		expect(lintSvelte(source, "Ok.svelte")).toEqual([]);
	});

	const svelte4 = {
		"export let props": `<script>export let name;</script><p>{name}</p>`,
		"reactive statements": `<script>let a = 1; let b; $: b = a * 2;</script><p>{b}</p>`,
		"on: event directives": `<script>let n = 0;</script><button on:click={() => n++}>{n}</button>`,
		"slot elements": `<div><slot /></div>`,
		"createEventDispatcher": `<script>import { createEventDispatcher } from 'svelte'; const d = createEventDispatcher();</script><p>x</p>`,
		"svelte:component": `<script>let C;</script><svelte:component this={C} />`,
	};
	for (const [name, source] of Object.entries(svelte4)) {
		it(`rejects Svelte 4 syntax: ${name}`, () => {
			expect(lintSvelte(source, "Old.svelte").length).toBeGreaterThan(0);
		});
	}
});
