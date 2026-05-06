import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type {
	FontFamily,
	FontWeight,
	ReaderSettings,
	ThemeName,
} from "../models/types.js";
import { getResolvedTheme } from "../services/theme-service.js";
import { trackEvent } from "../utils/analytics.js";
import "./ui/range.js";
import "./ui/segmented.js";
import "./ui/toggle.js";

const TOOLTIPS = {
	sentencePause:
		"Extra duration after periods, question marks, and exclamation points.",
	paragraphPause: "Extra delay when a new paragraph begins.",
	letterSpacing: "Adjust the horizontal space between characters.",
	pivotOffset:
		"Nudges the focus point left or right if you prefer eye-fixation off-center.",
	speedRamp:
		"Slowly accelerates the speed at the start of a session so your brain can adjust.",
	bionicMode: "Bold the first few letters of each word to guide the eye.",
	smartSpeed:
		"Varies the duration of each word based on its character length (longer words dwell longer).",
	peripheralContext:
		"Shows a ghost of the previous and next words to help stay oriented.",
	orpGuides:
		"Small markers above and below the focus point to help lock your gaze.",
	colorizeQuotes:
		"Apply a distinct color to words inside double quotes (dialogue).",
	colorizeParens:
		"Apply a distinct color to words inside parentheses or square brackets (asides).",
	irlenMode:
		"Color overlays to reduce visual stress and improve focus (Irlen Syndrome).",
	dyslexiaMode:
		"Uses OpenDyslexic, a font designed to improve readability for neurodivergent readers.",
	contextPauseOnClose:
		"Slight extra pause after closing ) or ] to help process the phrase.",
	commaAsPause:
		"Treat commas with the same weighted pause as full sentence ends.",
	countdown: "Show a 3-2-1 timer before the text starts flowing.",
	clickSound:
		"Soft procedural clicks synchronized with word flashes for rhythmic focus.",
	fontWeight:
		"Heavier weight makes text easier to track. Many dyslexic readers prefer medium-to-bold weights.",
	irlenOpacity: "Adjust how strong the color tint is.",
};

const FONTS: FontFamily[] = [
	"JetBrains Mono",
	"Fira Mono",
	"Source Code Pro",
	"Inconsolata",
	"IBM Plex Mono",
];

@customElement("settings-panel")
export class SettingsPanel extends LitElement {
	protected override createRenderRoot() {
		return this;
	}

	@property({ type: Object }) settings!: ReaderSettings;

	private emit(partial: Partial<ReaderSettings>): void {
		this.dispatchEvent(
			new CustomEvent("settings-change", {
				detail: { ...this.settings, ...partial },
				bubbles: true,
				composed: true,
			}),
		);
	}

	override render() {
		const s = this.settings;
		const theme: ThemeName = s.theme ?? "system";
		const effectiveTheme = theme === "system" ? getResolvedTheme(theme) : theme;
		const themeOptions: ("light" | "dark")[] = ["light", "dark"];
		const themeLabels: Record<"light" | "dark", string> = {
			light: "☀️ Light",
			dark: "🌙 Dark",
		};

		return html`
      <div class="flex flex-col gap-0 p-4 md:px-5 overflow-x-hidden">

        <!-- Theme -->
        <section class="pb-6">
          <span class="text-xs uppercase tracking-widest text-ui-muted block mb-2">Theme</span>
          <speeedy-segmented
            group-label="Theme"
            .options=${themeOptions.map((t) => ({ value: t, label: themeLabels[t] }))}
            .value=${effectiveTheme}
            @change=${(e: CustomEvent) => {
							trackEvent("theme-changed", { theme: e.detail.value });
							this.emit({ theme: e.detail.value });
						}}
          ></speeedy-segmented>
        </section>

        <!-- Speed -->
        <section class="pb-6">
          <speeedy-range
            label="Speed"
            min="100" max="1600" step="25"
            .value=${s.wpm}
            unit=" WPM"
            min-label="100"
            max-label="1600"
            @change=${(e: CustomEvent) => this.emit({ wpm: e.detail.value })}
          ></speeedy-range>
        </section>

        <!-- Font Size -->
        <section class="pb-6">
          <speeedy-range
            label="Font size"
            min="16" max="256" step="4"
            .value=${s.fontSize}
            unit="px"
            @change=${(e: CustomEvent) => this.emit({ fontSize: e.detail.value })}
          ></speeedy-range>
        </section>

        <!-- Letter Spacing -->
        <section class="pb-6">
          <speeedy-range
            label="Letter spacing"
            min="0" max="0.5" step="0.01"
            .value=${s.letterSpacing}
            .format=${(v: number) => `${v.toFixed(2)}em`}
            min-label="0em"
            max-label="0.5em"
            tip=${TOOLTIPS.letterSpacing}
            @change=${(e: CustomEvent) => this.emit({ letterSpacing: e.detail.value })}
          ></speeedy-range>
        </section>

        <!-- Pivot Position -->
        <section class="pb-6">
          <speeedy-range
            label="Pivot offset"
            min="-30" max="30" step="1"
            .value=${s.pivotOffset ?? 0}
            .format=${(v: number) => (v === 0 ? "Centre" : v > 0 ? `+${v}%` : `${v}%`)}
            min-label="-30%"
            max-label="+30%"
            tip=${TOOLTIPS.pivotOffset}
            @change=${(e: CustomEvent) => this.emit({ pivotOffset: e.detail.value })}
          ></speeedy-range>
        </section>

        <!-- Advanced timing -->
        <section class="border-t border-base-200 pt-6 pb-2" aria-labelledby="settings-advanced-heading">
          <h2 id="settings-advanced-heading" class="text-xs uppercase tracking-widest text-ui-muted font-medium mb-4">
            Advanced timing
          </h2>
          <div class="flex flex-col gap-5">
            <speeedy-range
              label="Sentence pause"
              min="1" max="10" step="0.5"
              .value=${s.sentencePauseMultiplier}
              unit="×"
              min-label="1×"
              max-label="10×"
              tip=${TOOLTIPS.sentencePause}
              @change=${(e: CustomEvent) => this.emit({ sentencePauseMultiplier: e.detail.value })}
            ></speeedy-range>
            <speeedy-range
              label="Paragraph pause"
              hint="Extra dwell at paragraph start"
              min="1" max="3" step="0.1"
              .value=${s.paragraphPauseMultiplier ?? 1}
              .format=${(v: number) => `${v.toFixed(1)}×`}
              min-label="1×"
              max-label="3×"
              tip=${TOOLTIPS.paragraphPause}
              @change=${(e: CustomEvent) => this.emit({ paragraphPauseMultiplier: e.detail.value })}
            ></speeedy-range>
            <div class="flex flex-col gap-3">
              <speeedy-toggle
                label="Speed ramp"
                hint="Accelerate gradually to target"
                ?checked=${s.speedRampEnabled}
                tip=${TOOLTIPS.speedRamp}
                @change=${(e: CustomEvent) => this.emit({ speedRampEnabled: e.detail.value })}
              ></speeedy-toggle>
              ${
								s.speedRampEnabled
									? html`
                <speeedy-range
                  label="Target WPM"
                  min="100" max="1600" step="25"
                  .value=${s.speedRampTarget}
                  unit=" WPM"
                  color="secondary"
                  min-label="100"
                  max-label="1600"
                  @change=${(e: CustomEvent) => this.emit({ speedRampTarget: e.detail.value })}
                ></speeedy-range>
              `
									: ""
							}
            </div>
          </div>
        </section>

        <!-- Accessibility & visuals -->
        <section class="border-t border-base-200 pt-6 pb-2" aria-labelledby="settings-a11y-heading">
          <h2 id="settings-a11y-heading" class="text-xs uppercase tracking-widest text-ui-muted font-medium mb-4">
            Accessibility & visuals
          </h2>
          <div class="flex flex-col gap-6">
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="text-xs uppercase tracking-widest text-ui-muted">Reading font</span>
                ${s.dyslexiaMode ? html`<span class="text-[10px] bg-warning text-warning-content px-1.5 py-0.5 rounded font-medium uppercase shrink-0">Dyslexic active</span>` : ""}
              </div>
              <div class="rounded-xl border border-base-200 bg-base-200/20 p-1.5 flex flex-col gap-0.5 ${s.dyslexiaMode ? "opacity-40 pointer-events-none grayscale" : ""}">
                ${FONTS.map(
									(font) => html`
                  <button
                    type="button"
                    class="btn btn-sm justify-start min-h-10 rounded-lg ${s.fontFamily === font ? "bg-base-100 shadow-sm font-semibold border border-primary/40" : "btn-ghost border border-transparent"}"
                    style="font-family: '${font}', monospace;"
                    @click=${() => this.emit({ fontFamily: font })}
                    ?disabled=${s.dyslexiaMode}
                    aria-pressed="${s.fontFamily === font}"
                  >${font}</button>
                `,
								)}
              </div>
            </div>
            <speeedy-range
              label="Font weight"
              min="300" max="800" step="100"
              .value=${s.fontWeight ?? 400}
              .format=${(v: number) => {
								const labels: Record<number, string> = {
									300: "Light",
									400: "Regular",
									500: "Medium",
									600: "Semi-bold",
									700: "Bold",
									800: "Extra-bold",
								};
								return labels[v] ?? String(v);
							}}
              min-label="Light"
              max-label="Extra-bold"
              tip=${TOOLTIPS.fontWeight}
              @change=${(e: CustomEvent) => this.emit({ fontWeight: e.detail.value as FontWeight })}
            ></speeedy-range>
            <div class="flex flex-col gap-3">
              <span class="text-xs uppercase tracking-widest text-ui-muted">Visual highlights</span>
              <div class="rounded-xl border border-base-200/80 bg-base-100/40 p-3 flex flex-col gap-3">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm text-base-content">Pivot (ORP)</span>
                  <input
                    type="color" .value=${s.highlightColor}
                    aria-label="ORP pivot highlight color"
                    @input=${(e: InputEvent) => this.emit({ highlightColor: (e.target as HTMLInputElement).value })}
                    class="w-9 h-9 rounded-lg shrink-0 cursor-pointer border border-base-300 bg-transparent"
                  />
                </div>
                <div class="flex flex-col gap-2">
                  <speeedy-toggle
                    label="Colorize dialogue"
                    ?checked=${s.colorizeQuotes ?? false}
                    tip=${TOOLTIPS.colorizeQuotes}
                    @change=${(e: CustomEvent) => this.emit({ colorizeQuotes: e.detail.value })}
                  ></speeedy-toggle>
                  ${
										s.colorizeQuotes
											? html`
                    <div class="flex items-center justify-between gap-3 pl-0.5">
                      <span class="text-xs text-ui-muted-subtle">Quote color</span>
                      <input
                        type="color" .value=${s.quoteHighlightColor}
                        aria-label="Dialogue quote highlight color"
                        @input=${(e: InputEvent) => this.emit({ quoteHighlightColor: (e.target as HTMLInputElement).value })}
                        class="w-9 h-9 rounded-lg shrink-0 cursor-pointer border border-base-300 bg-transparent"
                      />
                    </div>
                  `
											: ""
									}
                </div>
                <div class="flex flex-col gap-2">
                  <speeedy-toggle
                    label="Colorize asides ( ) [ ]"
                    ?checked=${s.colorizeParens ?? false}
                    tip=${TOOLTIPS.colorizeParens}
                    @change=${(e: CustomEvent) => this.emit({ colorizeParens: e.detail.value })}
                  ></speeedy-toggle>
                  ${
										s.colorizeParens
											? html`
                    <div class="flex items-center justify-between gap-3 pl-0.5">
                      <span class="text-xs text-ui-muted-subtle">Aside color</span>
                      <input
                        type="color" .value=${s.parenHighlightColor}
                        aria-label="Parentheses and brackets highlight color"
                        @input=${(e: InputEvent) => this.emit({ parenHighlightColor: (e.target as HTMLInputElement).value })}
                        class="w-9 h-9 rounded-lg shrink-0 cursor-pointer border border-base-300 bg-transparent"
                      />
                    </div>
                  `
											: ""
									}
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-4">
              <speeedy-toggle
                label="Dyslexia-friendly font"
                ?checked=${s.dyslexiaMode}
                tip=${TOOLTIPS.dyslexiaMode}
                @change=${(e: CustomEvent) => {
									trackEvent("dyslexia-toggled", { enabled: e.detail.value });
									this.emit({ dyslexiaMode: e.detail.value });
								}}
              ></speeedy-toggle>
              <div>
                <span class="text-sm text-base-content block mb-2">Irlen overlay tint</span>
                <speeedy-segmented
                  .options=${(
										["none", "peach", "mint", "parchment"] as const
									).map((mode) => {
										const colors: Record<string, string> = {
											peach: "background: #ffcc99; color: #4d2600;",
											mint: "background: #ccffdd; color: #004d1a;",
											parchment: "background: #f4ead5; color: #5c4d33;",
										};
										return {
											value: mode,
											label:
												mode === "none"
													? "Off"
													: mode.charAt(0).toUpperCase() + mode.slice(1),
											style: mode === "none" ? "" : colors[mode],
										};
									})}
                  .value=${s.irlenMode ?? "none"}
                  @change=${(e: CustomEvent) => this.emit({ irlenMode: e.detail.value })}
                ></speeedy-segmented>
                ${
									s.irlenMode && s.irlenMode !== "none"
										? html`
                  <div class="mt-3">
                    <speeedy-range
                      label="Overlay intensity"
                      min="0.05" max="0.5" step="0.01"
                      .value=${s.irlenOpacity ?? 0.18}
                      .format=${(v: number) => `${Math.round(v * 100)}%`}
                      min-label="5%"
                      max-label="50%"
                      tip=${TOOLTIPS.irlenOpacity}
                      @change=${(e: CustomEvent) => this.emit({ irlenOpacity: e.detail.value })}
                    ></speeedy-range>
                  </div>
                `
										: ""
								}
              </div>
            </div>
            <div class="flex flex-col gap-4 pt-2 border-t border-base-200/60">
              <span class="text-xs uppercase tracking-widest text-ui-muted">Pause &amp; anchor</span>
              <div>
                <span class="text-sm text-base-content block mb-2">Pause view mode</span>
                <speeedy-segmented
                  .options=${(["focus", "context", "fulltext"] as const).map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))}
                  .value=${s.pauseView ?? "focus"}
                  @change=${(e: CustomEvent) => this.emit({ pauseView: e.detail.value })}
                ></speeedy-segmented>
              </div>
              <div>
                <span class="text-sm text-base-content block mb-2">Bionic anchor position</span>
                <speeedy-segmented
                  .options=${(["early", "balanced", "late"] as const).map((pos) => ({ value: pos, label: pos.charAt(0).toUpperCase() + pos.slice(1) }))}
                  .value=${s.bionicFocusPosition ?? "balanced"}
                  @change=${(e: CustomEvent) => this.emit({ bionicFocusPosition: e.detail.value })}
                ></speeedy-segmented>
              </div>
            </div>
          </div>
        </section>

        <!-- Reading features -->
        <section class="border-t border-base-200 pt-6 pb-2">
          <h2 class="text-xs uppercase tracking-widest text-ui-muted font-medium mb-4">Reading features</h2>
          <div class="flex flex-col gap-3">
            <speeedy-toggle
              label="Show progress bar"
              ?checked=${s.showProgress}
              @change=${(e: CustomEvent) => this.emit({ showProgress: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="Focus mode (immersion)"
              ?checked=${s.focusModeEnabled ?? false}
              tip="While playing, hide the header, progress bar, bottom controls, and settings so only words show. Tap the reading area or Space to pause and bring controls back. Toggle anytime with F."
              @change=${(e: CustomEvent) => this.emit({ focusModeEnabled: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="ORP guide marks"
              ?checked=${s.showOrpGuides}
              tip=${TOOLTIPS.orpGuides}
              @change=${(e: CustomEvent) => this.emit({ showOrpGuides: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="Hide trailing punctuation"
              ?checked=${s.hidePunctuationInDisplay ?? false}
              @change=${(e: CustomEvent) => this.emit({ hidePunctuationInDisplay: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="Remove citations"
              ?checked=${s.removeCitations ?? false}
              tip="Strip inline citations like [1], [1-3], and (Smith et al., 2020) for distraction-free academic reading."
              @change=${(e: CustomEvent) => this.emit({ removeCitations: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="Ticker mode"
              ?checked=${s.tickerMode ?? false}
              tip="Instead of flashing one word at a time, text scrolls horizontally at your configured WPM. Speed, pause, and seek all work as normal."
              @change=${(e: CustomEvent) => this.emit({ tickerMode: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="Smart speed logic"
              ?checked=${s.smartSpeed}
              tip=${TOOLTIPS.smartSpeed}
              @change=${(e: CustomEvent) => this.emit({ smartSpeed: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="Bionic reading fixations"
              ?checked=${s.bionicMode}
              tip=${TOOLTIPS.bionicMode}
              @change=${(e: CustomEvent) => {
								trackEvent("bionic-toggled", { enabled: e.detail.value });
								this.emit({ bionicMode: e.detail.value });
							}}
            ></speeedy-toggle>

            <div class="flex flex-col gap-2">
              <speeedy-toggle
                label="Peripheral context"
                ?checked=${s.peripheralContext}
                tip=${TOOLTIPS.peripheralContext}
                @change=${(e: CustomEvent) => this.emit({ peripheralContext: e.detail.value })}
              ></speeedy-toggle>
              ${
								s.peripheralContext
									? html`
                <div class="pl-1 mt-1">
                  <speeedy-range
                    label="Density (words each side)"
                    min="1" max="3" step="1"
                    .value=${s.peripheralContextCount ?? 1}
                    min-label="1"
                    max-label="3"
                    @change=${(e: CustomEvent) => this.emit({ peripheralContextCount: e.detail.value })}
                  ></speeedy-range>
                </div>
              `
									: ""
							}
            </div>
          </div>
        </section>

        <!-- Audio -->
        <section class="border-t border-base-200 pt-6 pb-2">
          <h2 class="text-xs uppercase tracking-widest text-ui-muted font-medium mb-4">Audio &amp; focus</h2>
          <div class="flex flex-col gap-5">
            <!-- Clicks -->
            <div class="flex flex-col gap-3">
              <speeedy-toggle
                label="Tactile word clicks"
                ?checked=${s.clickSoundEnabled ?? false}
                tip=${TOOLTIPS.clickSound}
                @change=${(e: CustomEvent) => this.emit({ clickSoundEnabled: e.detail.value })}
              ></speeedy-toggle>
              ${
								s.clickSoundEnabled
									? html`
                <div class="pl-1">
                  <speeedy-range
                    label="Click pitch factor"
                    min="0.1" max="3.0" step="0.1"
                    .value=${s.clickSoundPitch ?? 1.0}
                    .format=${(v: number) => `${v.toFixed(1)}x`}
                    min-label="0.1x"
                    max-label="3.0x"
                    @change=${(e: CustomEvent) => this.emit({ clickSoundPitch: e.detail.value })}
                  ></speeedy-range>
                </div>
              `
									: ""
							}
            </div>
            <!-- Ambient -->
            <div class="flex flex-col gap-3">
              <div>
                <span class="text-sm text-base-content block mb-2">Ambient focus noise</span>
                <speeedy-segmented
                  .options=${(["none", "white", "pink", "brown"] as const).map(
										(n) => {
											const colors: Record<string, string> = {
												white: "background: #f8fafc; color: #0f172a;",
												pink: "background: #fce7f3; color: #831843;",
												brown: "background: #78350f; color: #fef3c7;",
											};
											return {
												value: n,
												label:
													n === "none"
														? "Off"
														: n.charAt(0).toUpperCase() + n.slice(1),
												style: n === "none" ? "" : colors[n],
											};
										},
									)}
                  .value=${s.ambientNoise ?? "none"}
                  @change=${(e: CustomEvent) => {
										if (e.detail.value !== "none") {
											trackEvent("ambient-noise-changed", {
												type: e.detail.value,
											});
										}
										this.emit({ ambientNoise: e.detail.value });
									}}
                ></speeedy-segmented>
              </div>
              ${
								s.ambientNoise && s.ambientNoise !== "none"
									? html`
                <div class="pl-1">
                  <speeedy-range
                    label="Noise volume"
                    min="0" max="1" step="0.05"
                    .value=${s.ambientVolume ?? 0.5}
                    .format=${(v: number) => `${Math.round(v * 100)}%`}
                    min-label="0%"
                    max-label="100%"
                    @change=${(e: CustomEvent) => this.emit({ ambientVolume: e.detail.value })}
                  ></speeedy-range>
                </div>
              `
									: ""
							}
            </div>
          </div>
        </section>

        <!-- Engine logic -->
        <section class="border-t border-base-200 pt-6 pb-4">
          <h2 class="text-xs uppercase tracking-widest text-ui-muted font-medium mb-4">Engine logic</h2>
          <div class="flex flex-col gap-4">
            <speeedy-toggle
              label="Start countdown (3s)"
              ?checked=${s.countdownEnabled ?? false}
              tip=${TOOLTIPS.countdown}
              @change=${(e: CustomEvent) => this.emit({ countdownEnabled: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="Comma pause beacon"
              ?checked=${s.commaAsPause ?? false}
              tip=${TOOLTIPS.commaAsPause}
              @change=${(e: CustomEvent) => this.emit({ commaAsPause: e.detail.value })}
            ></speeedy-toggle>
            <speeedy-toggle
              label="Aside closing pause"
              ?checked=${s.contextPauseOnClose ?? true}
              tip=${TOOLTIPS.contextPauseOnClose}
              @change=${(e: CustomEvent) => this.emit({ contextPauseOnClose: e.detail.value })}
            ></speeedy-toggle>
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm text-base-content">Rewind skip amount</span>
                <span class="font-mono text-sm font-medium">${s.rewindStep ?? 5}w</span>
              </div>
              <div class="flex items-center gap-1.5">
                ${([1, 3, 5] as const).map(
									(n) => html`
                  <button
                    class="btn btn-xs flex-1 ${(s.rewindStep ?? 5) === n ? "btn-primary" : "btn-ghost border border-base-300"}"
                    @click=${() => this.emit({ rewindStep: n })}
                  >${n}</button>
                `,
								)}
                <div class="flex-1 min-w-12 relative">
                  <input
                    type="number" min="1" max="100"
                    .value=${String([1, 3, 5].includes(s.rewindStep ?? 5) ? "" : s.rewindStep)}
                    placeholder=${[1, 3, 5].includes(s.rewindStep ?? 5) ? "..." : ""}
                    @input=${(e: InputEvent) => {
											const val = Number((e.target as HTMLInputElement).value);
											if (val > 0) this.emit({ rewindStep: val });
										}}
                    class="input input-xs input-bordered w-full pr-4 text-center font-mono"
                  />
                  <span class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] opacity-30 pointer-events-none">w</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div class="h-2"></div>
      </div>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"settings-panel": SettingsPanel;
	}
}
