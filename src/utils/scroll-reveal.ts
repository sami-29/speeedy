import { animate, inView } from "motion";

export const SCROLL_REVEAL = {
	ease: [0.16, 1, 0.3, 1] as const,
	duration: 0.6,
	translateYPx: 24,
	amount: 0.15 as const,
};

export const TIP_REVEAL = {
	ease: [0.25, 1, 0.5, 1] as const,
	duration: 0.4,
	translateYPx: 12,
	staggerSec: 0.06,
	amount: 0.1 as const,
};

export function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function initDataReveal(root: HTMLElement): void {
	const els = root.querySelectorAll<HTMLElement>("[data-reveal]");
	if (prefersReducedMotion()) {
		for (const el of els) {
			el.style.opacity = "1";
			el.style.transform = "none";
		}
		return;
	}

	const { ease, duration, translateYPx, amount } = SCROLL_REVEAL;
	const y = `${translateYPx}px`;
	for (const el of els) {
		el.style.opacity = "0";
		el.style.transform = `translateY(${y})`;
		inView(
			el,
			() => {
				animate(
					el,
					{
						opacity: [0, 1],
						transform: [`translateY(${y})`, "translateY(0px)"],
					},
					{ duration, ease },
				);
			},
			{ amount },
		);
	}
}

export function initTipReveal(root: HTMLElement): void {
	if (prefersReducedMotion()) return;

	const tipItems = Array.from(
		root.querySelectorAll<HTMLElement>("[data-tip-item]"),
	);
	if (!tipItems.length) return;

	const { ease, duration, translateYPx, staggerSec, amount } = TIP_REVEAL;
	const y = `${translateYPx}px`;
	for (const t of tipItems) {
		t.style.opacity = "0";
		t.style.transform = `translateY(${y})`;
	}
	inView(
		tipItems[0],
		() => {
			for (let i = 0; i < tipItems.length; i++) {
				animate(
					tipItems[i],
					{
						opacity: [0, 1],
						transform: [`translateY(${y})`, "translateY(0px)"],
					},
					{ delay: i * staggerSec, duration, ease },
				);
			}
		},
		{ amount },
	);
}
