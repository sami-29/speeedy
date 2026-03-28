import type { ToastType } from "../components/toast-container.js";
import type { ParsedDocument, Route, UserProfile } from "../models/types.js";

export interface NavigateDetail {
	route: Route;
	doc?: ParsedDocument;
	savedDocId?: string;
	resumeWordIndex?: number;
}

export function navigate(
	route: Route,
	doc?: ParsedDocument,
	savedDocId?: string,
	resumeWordIndex?: number,
): void {
	window.dispatchEvent(
		new CustomEvent("speeedy:navigate", {
			detail: { route, doc, savedDocId, resumeWordIndex },
		}),
	);
}

export function emitProfileUpdated(profile: UserProfile): void {
	window.dispatchEvent(
		new CustomEvent("speeedy:profile-updated", { detail: { profile } }),
	);
}

export function showToast(message: string, type: ToastType = "info"): void {
	window.dispatchEvent(
		new CustomEvent("speeedy:toast", { detail: { message, type } }),
	);
}

export function openFeedback(): void {
	window.dispatchEvent(new CustomEvent("speeedy:open-feedback"));
}
