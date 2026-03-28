/** Lucide → SVG string for Lit (light DOM). */

import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { IconNode } from "lucide";

function renderNode([tag, attrs]: IconNode[number]): string {
	const attrStr = Object.entries(attrs)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${k}="${v}"`)
		.join(" ");
	return `<${tag} ${attrStr}/>`;
}

export function icon(
	lucideIcon: IconNode,
	className = "w-4 h-4",
	strokeWidth = 1.5,
) {
	const inner = lucideIcon.map(renderNode).join("");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${className}">${inner}</svg>`;
	return unsafeHTML(svg);
}
