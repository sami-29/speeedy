declare global {
	interface Window {
		webkitAudioContext?: typeof AudioContext;
	}
}

class AudioService {
	private ctx: AudioContext | null = null;
	private ambientSource: AudioBufferSourceNode | null = null;
	private ambientGain: GainNode | null = null;
	private noiseBuffers: Map<string, AudioBuffer> = new Map();
	private isMuted = false;
	private currentNoiseType = "none";

	public get isMutedState(): boolean {
		return this.isMuted;
	}

	public toggleMute(): boolean {
		this.isMuted = !this.isMuted;
		if (this.isMuted) {
			this.stopAmbientNoise();
		}
		window.dispatchEvent(
			new CustomEvent("speeedy:sound-mute-change", {
				detail: { muted: this.isMuted },
			}),
		);
		return this.isMuted;
	}

	private getContext(): AudioContext | null {
		if (typeof window === "undefined") return null;
		if (this.ctx?.state === "closed") {
			this.ctx = null;
		}
		if (this.ctx) return this.ctx;
		try {
			this.ctx = new (window.AudioContext || window.webkitAudioContext)();
			return this.ctx;
		} catch {
			return null;
		}
	}

	public initOnInteraction(): void {
		if (typeof window === "undefined") return;
		const resumeCtx = () => {
			if (this.ctx && this.ctx.state !== "closed") {
				const state = this.ctx.state as string;
				if (state === "suspended" || state === "interrupted") {
					this.ctx.resume().catch(() => this.resetCtx());
				}
			}
		};
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") resumeCtx();
		});
		window.addEventListener("pageshow", resumeCtx);
		window.addEventListener("focus", resumeCtx);
		resumeCtx();
	}

	private resetCtx(): void {
		if (this.ctx && this.ctx.state !== "closed") {
			try {
				this.ctx.close();
			} catch {
				/* ignore */
			}
		}
		this.ctx = null;
	}

	private ensureResumed(callback: () => void): void {
		const ctx = this.getContext();
		if (!ctx) return;
		const state = ctx.state as string;
		if (state === "suspended" || state === "interrupted") {
			ctx
				.resume()
				.then(callback)
				.catch(() => this.resetCtx());
		} else {
			callback();
		}
	}

	public playTick(
		type: "tick" | "comma" | "sentence" = "tick",
		pitchMultiplier = 1,
	): void {
		if (this.isMuted) return;
		const ctx = this.getContext();
		if (!ctx) return;
		this.ensureResumed(() => {
			try {
				const now = ctx.currentTime;
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);

				const freq =
					(type === "sentence" ? 660 : type === "comma" ? 780 : 880) *
					pitchMultiplier;
				osc.type = "sine";
				osc.frequency.setValueAtTime(freq, now);

				const duration =
					type === "sentence" ? 0.015 : type === "comma" ? 0.01 : 0.008;
				const volume =
					type === "sentence" ? 0.04 : type === "comma" ? 0.03 : 0.035;

				gain.gain.setValueAtTime(volume, now);
				gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

				osc.start(now);
				osc.stop(now + duration);
			} catch {
				/* ignore audio errors */
			}
		});
	}

	public playHover(): void {
		if (this.isMuted) return;
		const ctx = this.getContext();
		if (!ctx) return;
		this.ensureResumed(() => {
			try {
				const now = ctx.currentTime;
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);

				osc.type = "sine";
				osc.frequency.setValueAtTime(1200, now);
				gain.gain.setValueAtTime(0.02, now);
				gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

				osc.start(now);
				osc.stop(now + 0.015);
			} catch {}
		});
	}

	public playClick(): void {
		if (this.isMuted) return;
		const ctx = this.getContext();
		if (!ctx) return;
		this.ensureResumed(() => {
			try {
				const now = ctx.currentTime;
				[880, 1100].forEach((freq, i) => {
					const time = now + i * 0.01;
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();
					osc.connect(gain);
					gain.connect(ctx.destination);
					osc.type = "sine";
					osc.frequency.setValueAtTime(freq, time);
					gain.gain.setValueAtTime(0.025, time);
					gain.gain.exponentialRampToValueAtTime(0.001, time + 0.012);
					osc.start(time);
					osc.stop(time + 0.012);
				});
			} catch {}
		});
	}

	public playOpen(): void {
		if (this.isMuted) return;
		const ctx = this.getContext();
		if (!ctx) return;
		this.ensureResumed(() => {
			try {
				const now = ctx.currentTime;
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.type = "sine";
				osc.frequency.setValueAtTime(440, now);
				osc.frequency.exponentialRampToValueAtTime(660, now + 0.04);
				gain.gain.setValueAtTime(0.055, now);
				gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
				osc.start(now);
				osc.stop(now + 0.06);
			} catch {}
		});
	}

	public playClose(): void {
		if (this.isMuted) return;
		const ctx = this.getContext();
		if (!ctx) return;
		this.ensureResumed(() => {
			try {
				const now = ctx.currentTime;
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.type = "sine";
				osc.frequency.setValueAtTime(660, now);
				osc.frequency.exponentialRampToValueAtTime(440, now + 0.04);
				gain.gain.setValueAtTime(0.055, now);
				gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
				osc.start(now);
				osc.stop(now + 0.06);
			} catch {}
		});
	}

	private async getNoiseBuffer(
		type: "white" | "pink" | "brown",
	): Promise<AudioBuffer | null> {
		const ctx = this.getContext();
		if (!ctx) return null;

		if (this.noiseBuffers.has(type)) {
			return this.noiseBuffers.get(type) ?? null;
		}

		const bufferSize = ctx.sampleRate * 10;
		const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
		const output = buffer.getChannelData(0);

		if (type === "white") {
			for (let i = 0; i < bufferSize; i++) {
				output[i] = Math.random() * 2 - 1;
			}
		} else if (type === "pink") {
			let b0 = 0,
				b1 = 0,
				b2 = 0,
				b3 = 0,
				b4 = 0,
				b5 = 0,
				b6 = 0;
			for (let i = 0; i < bufferSize; i++) {
				const white = Math.random() * 2 - 1;
				b0 = 0.99886 * b0 + white * 0.0555179;
				b1 = 0.99332 * b1 + white * 0.0750759;
				b2 = 0.969 * b2 + white * 0.153852;
				b3 = 0.8665 * b3 + white * 0.3104856;
				b4 = 0.55 * b4 + white * 0.5329522;
				b5 = -0.7616 * b5 - white * 0.016898;
				output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
				output[i] *= 0.13;
				b6 = white * 0.115926;
			}
		} else if (type === "brown") {
			let lastOut = 0;
			for (let i = 0; i < bufferSize; i++) {
				const white = Math.random() * 2 - 1;
				output[i] = (lastOut + 0.02 * white) / 1.02;
				lastOut = output[i];
				output[i] *= 5.5;
			}
		}

		// Crossfade the loop boundary to avoid clicks
		const fadeLen = ctx.sampleRate * 0.5;
		for (let i = 0; i < fadeLen; i++) {
			const ratio = i / fadeLen;
			output[i] =
				output[i] * ratio + output[bufferSize - fadeLen + i] * (1 - ratio);
		}

		this.noiseBuffers.set(type, buffer);
		return buffer;
	}

	public setAmbientNoise(
		type: "none" | "white" | "pink" | "brown",
		volume: number,
	): void {
		if (this.isMuted || type === "none") {
			this.stopAmbientNoise();
			this.currentNoiseType = "none";
			return;
		}

		const ctx = this.getContext();
		if (!ctx) return;

		if (this.currentNoiseType === type && this.ambientGain) {
			const now = ctx.currentTime;
			this.ambientGain.gain.linearRampToValueAtTime(
				this.ambientGain.gain.value,
				now,
			);
			this.ambientGain.gain.linearRampToValueAtTime(volume * 0.05, now + 0.05);
			return;
		}

		this.ensureResumed(async () => {
			const buffer = await this.getNoiseBuffer(type);
			if (!buffer) return;

			this.currentNoiseType = type;
			const now = ctx.currentTime;

			const oldSource = this.ambientSource;
			const oldGain = this.ambientGain;

			const newSource = ctx.createBufferSource();
			const newGain = ctx.createGain();
			newSource.buffer = buffer;
			newSource.loop = true;
			newSource.connect(newGain);
			newGain.connect(ctx.destination);

			newGain.gain.setValueAtTime(0, now);
			newGain.gain.linearRampToValueAtTime(volume * 0.05, now + 0.8);
			newSource.start(now);

			if (oldSource && oldGain) {
				oldGain.gain.linearRampToValueAtTime(oldGain.gain.value, now);
				oldGain.gain.linearRampToValueAtTime(0, now + 0.8);
				oldSource.stop(now + 0.8);
			}

			this.ambientSource = newSource;
			this.ambientGain = newGain;
		});
	}

	/** Pomodoro phase chimes (focus / break / longbreak). */
	public playChime(type: "focus" | "break" | "longbreak"): void {
		if (this.isMuted) return;
		const ctx = this.getContext();
		if (!ctx) return;
		this.ensureResumed(() => {
			try {
				const now = ctx.currentTime;
				const notes =
					type === "focus"
						? [523.25, 659.25, 783.99]
						: type === "longbreak"
							? [261.63, 392.0, 523.25]
							: [783.99, 659.25, 523.25];
				notes.forEach((freq, i) => {
					const t = now + i * 0.18;
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();
					osc.connect(gain);
					gain.connect(ctx.destination);
					osc.type = "sine";
					osc.frequency.setValueAtTime(freq, t);
					gain.gain.setValueAtTime(0.001, t);
					gain.gain.linearRampToValueAtTime(0.08, t + 0.03);
					gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
					osc.start(t);
					osc.stop(t + 0.36);
				});
			} catch {
				/* ignore */
			}
		});
	}

	public stopAmbientNoise(): void {
		if (this.ambientSource && this.ambientGain) {
			const ctx = this.getContext();
			if (ctx) {
				const now = ctx.currentTime;
				this.ambientGain.gain.linearRampToValueAtTime(0, now + 0.5);
				this.ambientSource.stop(now + 0.5);
			} else {
				this.ambientSource.stop();
			}
			this.ambientSource = null;
			this.ambientGain = null;
		}
	}
}

export const audioService = new AudioService();
