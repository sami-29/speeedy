<script lang="ts">
import { baseLanguage, listenLanguage } from "@speeedy/contracts";
import { createAudioClock, type SpeechClock } from "@speeedy/engine";
import { onDestroy, untrack } from "svelte";
import { audio } from "#lib/audio/instance.ts";
import { gainFor } from "#lib/audio/system.ts";
import { languageName } from "#lib/library/languages.ts";
import { m } from "#lib/paraglide/messages.js";
import { trackEvent } from "#lib/telemetry.ts";
import { canUseOnDeviceVoice, onDeviceVoice } from "#lib/voice/instance.ts";
import {
	createKokoroSpeaker,
	type FallbackReason,
	isKokoroVoice,
	KOKORO_VOICE,
} from "#lib/voice/kokoro-speaker.ts";
import type { OnDeviceState, OnDeviceVoice } from "#lib/voice/on-device.ts";
import { voiceRating } from "#lib/voice/rating.ts";
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
import { routeSpeaker, type Speaker } from "./listen/speaker.ts";
import { pickVoice, type VoiceLike } from "./listen/voices.ts";
import type { ModeProps } from "./modes.ts";
import PacerView from "./PacerView.svelte";
import type { PacerDom } from "./pacer/dom.ts";

let { engine, doc, autoplay = true, clock, language }: ModeProps = $props();

/** A drag along the progress bar speaks once it has stopped for this long. */
const SEEK_SETTLE_MS = 150;

// The browser's voice cannot be routed through Web Audio, so the voice volume is set on each
// sentence instead. Ducking of the ambient bed follows the Engine's play and pause.
const speech = browserSpeech(window, () =>
	gainFor(audio().prefs.volumes.voice),
);
const storage = listenStorage();

let prefs = $state<ListenPrefs>(loadPrefs(storage));
let voices = $state.raw<readonly VoiceLike[]>([]);
let status = $state<"idle" | "speaking" | "blocked" | "failed">("idle");
let wordSync = $state<"unknown" | "word" | "sentence">("unknown");
let listener: Listener | undefined;

// The on-device voice speaks English only, and needs a worker, Cache Storage and Web Audio.
// Checking whether it is downloaded reads the cache alone: no worker starts and no host is
// asked until the reader agrees to the download.
const onDevice: OnDeviceVoice | undefined =
	speech &&
	baseLanguage(untrack(() => language)) === "en" &&
	canUseOnDeviceVoice()
		? onDeviceVoice()
		: undefined;
let device = $state.raw<OnDeviceState | undefined>(onDevice?.state);
/** Why the on-device voice stopped, if it did: it failed, or it cannot keep up here. */
let gaveWay = $state<FallbackReason | null>(null);
const stopDevice = onDevice?.subscribe(() => {
	device = onDevice.state;
});
if (onDevice?.state.phase === "unknown") void onDevice.check();
onDestroy(() => stopDevice?.());

/** Downloaded: offered in the voice list. A failed voice stays there, so it can be tried again. */
const deviceReady = $derived(
	device?.phase === "downloaded" ||
		device?.phase === "loading" ||
		device?.phase === "ready" ||
		device?.phase === "failed",
);
const deviceVoice = { ...KOKORO_VOICE, name: m.listen_on_device_voice() };

const stopVoices = speech?.voices.subscribe((list) => {
	voices = list;
});
onDestroy(() => {
	stopVoices?.();
	speech?.voices.dispose();
});

const code = $derived(baseLanguage(language));
// The on-device voice is used only when the reader chose it: never picked on its own.
const choice = $derived(
	deviceReady && prefs.voices[code ?? "und"] === KOKORO_VOICE.voiceURI
		? { voice: deviceVoice, matched: true }
		: pickVoice(voices, language, prefs.voices[code ?? "und"]),
);
/** The voices worth offering: those that speak the document's language, if any do. */
const offered = $derived.by(() => {
	const same = code
		? voices.filter((voice) => baseLanguage(voice.lang) === code)
		: [];
	const browser = same.length > 0 ? same : voices;
	return deviceReady ? [deviceVoice, ...browser] : browser;
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

const deviceNote = $derived(
	gaveWay === "slow"
		? m.listen_on_device_slow()
		: gaveWay === "failed"
			? m.listen_on_device_failed()
			: null,
);

/**
 * Listen's Speaker: the on-device voice for its own sentences, the browser's for the rest.
 * The on-device voice plays through the voice bus on the audio Clock; when it fails or is
 * too slow here, the browser's voice takes over and the choice moves to it.
 */
function speakerFor(browser: Speaker, device: OnDeviceVoice | undefined) {
	if (!device) return browser;
	const sound = audio();
	const clock = createAudioClock(() => sound.context);
	let own: Speaker | undefined;
	const make = () =>
		createKokoroSpeaker({
			render: (sentence, speed, signal) =>
				device.render(sentence, speed, signal),
			audio: sound,
			clock,
			fallback: browser,
			onFallback: (reason) => {
				gaveWay = reason;
				// A failed voice is made again if the reader picks it again.
				if (reason === "failed") own = undefined;
				chooseVoice(undefined);
			},
			onPlayed: (seconds) => voiceRating().played("kokoro", seconds),
		});
	return routeSpeaker((voice) => {
		if (!isKokoroVoice(voice)) return browser;
		own ??= make();
		return own;
	});
}

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
		speaker: speakerFor(speech.speaker, onDevice),
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
	if (uri === KOKORO_VOICE.voiceURI) gaveWay = null;
	prefs = withVoice(prefs, language, uri);
	savePrefs(storage, prefs);
}

/** The reader agreed to the download: fetch the voice, then read with it. */
async function downloadVoice() {
	if (!onDevice) return;
	gaveWay = null;
	if (await onDevice.download()) chooseVoice(KOKORO_VOICE.voiceURI);
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
			device={onDevice ? device : undefined}
			ondownload={downloadVoice}
			{deviceNote}
		/>
	{/snippet}
</PacerView>
