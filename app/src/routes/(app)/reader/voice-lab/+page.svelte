<script lang="ts">
// Voice lab: a bare diagnostic page for the on-device Kokoro voice (isolation, threads,
// download, one test sentence and its real-time factor). It is not linked from anywhere and
// is not the Listen UI, so its copy stays in English and outside the message catalogue.
import { createKokoroClient, type KokoroClient } from "@speeedy/kokoro/client";
import { onDestroy, onMount } from "svelte";
import KokoroWorker from "#lib/voice/kokoro.worker.ts?worker";

const SENTENCE = "The quick brown fox jumps over the lazy dog.";

let client: KokoroClient | undefined;
/** The worker's own isolation, which is what lets it use WASM threads. */
let isolated = $state<boolean>();
let threads = $state<number>();
let downloaded = $state(false);
let sizeLabel = $state("");
let voiceState = $state<"idle" | "downloading" | "ready" | "error">("idle");
let progress = $state(0);
let message = $state("");
let words = $state<number>();
let rtf = $state<number>();

onMount(async () => {
	client = createKokoroClient(new KokoroWorker({ name: "kokoro" }));
	client.onProgress((loaded, total) => {
		progress = total ? loaded / total : 0;
	});
	const status = await client.status();
	isolated = status.crossOriginIsolated;
	threads = status.threads;
	downloaded = status.downloaded;
	sizeLabel = status.totalLabel;
});
onDestroy(() => client?.terminate());

async function download() {
	if (!client) return;
	voiceState = "downloading";
	message = "";
	try {
		threads = (downloaded ? await client.load() : await client.download())
			.threads;
		downloaded = true;
		voiceState = "ready";
	} catch (error) {
		voiceState = "error";
		message = error instanceof Error ? error.message : String(error);
	}
}

async function generate() {
	if (!client) return;
	message = "";
	const start = performance.now();
	try {
		const result = await client.generate(SENTENCE, { voice: "af_msa" });
		const seconds = (performance.now() - start) / 1000;
		rtf = seconds / (result.samples.length / result.sampleRate);
		words = result.words.length;
		const context = new AudioContext({ sampleRate: result.sampleRate });
		const buffer = context.createBuffer(
			1,
			result.samples.length,
			result.sampleRate,
		);
		buffer.copyToChannel(result.samples as Float32Array<ArrayBuffer>, 0);
		const node = context.createBufferSource();
		node.buffer = buffer;
		node.connect(context.destination);
		node.start();
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
}
</script>

<svelte:head>
	<title>Voice lab</title>
</svelte:head>

<div class="poster pt-s-6">
	<h1 class="headline poster-head">Voice lab</h1>
	<dl class="mt-s-3 grid max-w-[40ch] grid-cols-2 gap-s-1">
		<dt class="label">Cross-origin isolated</dt>
		<dd data-testid="voice-isolated">{isolated === undefined ? "" : isolated ? "yes" : "no"}</dd>
		<dt class="label">WASM threads</dt>
		<dd data-testid="voice-threads">{threads ?? ""}</dd>
		<dt class="label">Downloaded</dt>
		<dd data-testid="voice-downloaded">{downloaded ? "yes" : "no"}</dd>
		<dt class="label">State</dt>
		<dd data-testid="voice-state">{voiceState}</dd>
		<dt class="label">Timed words</dt>
		<dd data-testid="voice-words">{words ?? ""}</dd>
		<dt class="label">Real-time factor</dt>
		<dd data-testid="voice-rtf">{rtf === undefined ? "" : rtf.toFixed(3)}</dd>
	</dl>
	<div class="mt-s-3 flex flex-wrap gap-s-2">
		<button
			type="button"
			class="segment border-2 border-ink"
			disabled={threads === undefined || voiceState === "downloading" || voiceState === "ready"}
			onclick={download}
		>
			{downloaded ? "Load the voice" : `Download the voice (${sizeLabel})`}
		</button>
		<button
			type="button"
			class="segment border-2 border-ink"
			disabled={voiceState !== "ready"}
			onclick={generate}
		>
			Generate a test sentence
		</button>
	</div>
	{#if voiceState === "downloading"}
		<p class="mt-s-2" role="status">{Math.round(progress * 100)}%</p>
	{/if}
	{#if message}
		<p class="mt-s-2" role="alert">{message}</p>
	{/if}
</div>
