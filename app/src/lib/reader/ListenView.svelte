<script lang="ts">
import { baseLanguage, listenLanguage } from "@speeedy/contracts";
import type { SpeechClock } from "@speeedy/engine";
import { onDestroy, untrack } from "svelte";
import { languageName } from "#lib/library/languages.ts";
import { m } from "#lib/paraglide/messages.js";
import { trackEvent } from "#lib/telemetry.ts";
import ListenControls from "./ListenControls.svelte";
import { browserSpeech, listenStorage } from "./listen/browser.ts";
import { createListener, type Listener } from "./listen/listener.ts";
import {
	type ListenPrefs,
	loadPrefs,
	savePrefs,
	stepRate,
	withRate,
	withVoice,
} from "./listen/prefs.ts";
import { pickVoice, type VoiceLike } from "./listen/voices.ts";
import type { ModeProps } from "./modes.ts";
import PacerView from "./PacerView.svelte";
import type { PacerDom } from "./pacer/dom.ts";

let { engine, doc, autoplay = true, clock, language }: ModeProps = $props();

/** A drag along the progress bar speaks once it has stopped for this long. */
const SEEK_SETTLE_MS = 150;

const speech = browserSpeech();
const storage = listenStorage();

let prefs = $state<ListenPrefs>(loadPrefs(storage));
let voices = $state.raw<readonly VoiceLike[]>([]);
let status = $state<"idle" | "speaking" | "blocked" | "failed">("idle");
let wordSync = $state<"unknown" | "word" | "sentence">("unknown");
let listener: Listener | undefined;

const stopVoices = speech?.voices.subscribe((list) => {
	voices = list;
});
onDestroy(() => {
	stopVoices?.();
	speech?.voices.dispose();
});

const code = $derived(baseLanguage(language));
const choice = $derived(
	pickVoice(voices, language, prefs.voices[code ?? "und"]),
);
/** The voices worth offering: those that speak the document's language, if any do. */
const offered = $derived.by(() => {
	const same = code
		? voices.filter((voice) => baseLanguage(voice.lang) === code)
		: [];
	return same.length > 0 ? same : voices;
});

// A change of voice or speed, from the reader or from a late voice list, carries on from the
// Cursor. The Listener ignores a voice it already has.
$effect(() => {
	listener?.setVoice(choice.voice);
});
$effect(() => {
	listener?.setRate(prefs.rate);
});

const languageNote = $derived.by(() => {
	// Only for a text that is not English, and only once the browser has told us its voices.
	if (!code || code === "en" || voices.length === 0) return null;
	const name = languageName(code);
	return choice.voice
		? m.listen_note_voice({ language: name, voice: choice.voice.name })
		: m.listen_note_no_voice({ language: name });
});

const problem = $derived(
	!speech
		? m.listen_unsupported()
		: status === "blocked"
			? m.listen_blocked()
			: status === "failed"
				? m.listen_failed()
				: null,
);

function asSpeechClock(value: unknown): SpeechClock {
	const candidate = value as Partial<SpeechClock> | undefined;
	if (!candidate || typeof candidate.advance !== "function") {
		throw new Error("Listen needs the speech Clock.");
	}
	return candidate as SpeechClock;
}

function follow(view: PacerDom, pane: HTMLElement) {
	const current = engine;
	if (!speech) {
		// Nothing can speak, so nothing plays: Play shows the notice and the Cursor stays.
		const stop = current.on("play", () => current.pause());
		return stop;
	}
	const made = createListener({
		engine: current,
		document: untrack(() => doc),
		clock: asSpeechClock(untrack(() => clock)),
		speaker: speech.speaker,
		language: untrack(() => language),
		voice: untrack(() => choice.voice),
		rate: untrack(() => prefs.rate),
		seekDelayMs: SEEK_SETTLE_MS,
	});
	listener = made;

	let shown: unknown;
	const show = () => {
		status = made.status;
		wordSync = made.wordSync;
		const mark = made.highlight;
		if (!mark || mark === shown) return;
		shown = mark;
		pane.dataset.granularity = mark.kind;
		view.show({ block: mark.block, from: mark.from, to: mark.to });
	};
	const stopListening = made.subscribe(show);
	show();

	// One start per visit to Listen; pausing and playing again is not another.
	let started = false;
	const stopStart = current.on("play", () => {
		if (started) return;
		started = true;
		trackEvent("listen_start", {
			document_language: listenLanguage(untrack(() => language)),
		});
	});

	return () => {
		stopStart();
		stopListening();
		made.dispose();
		listener = undefined;
		delete pane.dataset.granularity;
	};
}

function chooseVoice(uri: string | undefined) {
	prefs = withVoice(prefs, language, uri);
	savePrefs(storage, prefs);
}

function changeRate(direction: 1 | -1) {
	prefs = withRate(prefs, stepRate(prefs.rate, direction));
	savePrefs(storage, prefs);
}
</script>

<PacerView
	{engine}
	{doc}
	{clock}
	{language}
	autoplay={speech ? autoplay : false}
	{follow}
	label={m.listen_label()}
	testid="listen"
>
	{#snippet below()}
		<ListenControls
			voices={offered}
			selected={choice.voice}
			rate={prefs.rate}
			onvoice={chooseVoice}
			onrate={changeRate}
			{languageNote}
			sentenceNote={wordSync === "sentence"}
			{problem}
		/>
	{/snippet}
</PacerView>
