import {
	type Block,
	type Document,
	validateDocument,
} from "@speeedy/contracts";
import { expect } from "vitest";
import {
	PARSE_ERROR_REASONS,
	type ParseError,
	type ParseOutcome,
	type ParseSuccess,
} from "../src/index";

export const utf8 = (text: string): Uint8Array =>
	new TextEncoder().encode(text);

export function utf16(
	text: string,
	endian: "le" | "be",
	bom: boolean,
): Uint8Array {
	const units = (bom ? "\uFEFF" : "") + text;
	const out = new Uint8Array(units.length * 2);
	const view = new DataView(out.buffer);
	for (let i = 0; i < units.length; i++) {
		view.setUint16(i * 2, units.charCodeAt(i), endian === "le");
	}
	return out;
}

export const bytesOf = (...values: number[]): Uint8Array =>
	Uint8Array.from(values);

export const concat = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
};

/** Every outcome is either a valid Document or a typed error, whatever went in. */
export function expectWellFormed(outcome: ParseOutcome): void {
	expect(typeof outcome).toBe("object");
	if (outcome.ok) {
		const checked = validateDocument(outcome.document);
		expect(checked.ok, checked.ok ? "" : checked.error).toBe(true);
		expect(outcome.document.blocks.length).toBeGreaterThan(0);
		expect(typeof outcome.language.code).toBe("string");
	} else {
		expect(PARSE_ERROR_REASONS).toContain(outcome.reason);
		expect(typeof outcome.message).toBe("string");
		expect(outcome.message.length).toBeGreaterThan(0);
	}
}

export function expectSuccess(outcome: ParseOutcome): ParseSuccess {
	expectWellFormed(outcome);
	if (!outcome.ok) {
		throw new Error(
			`expected a Document, got ${outcome.reason}: ${outcome.message}`,
		);
	}
	return outcome;
}

export function expectError(
	outcome: ParseOutcome,
	reason: ParseError["reason"],
): ParseError {
	expectWellFormed(outcome);
	if (outcome.ok) {
		throw new Error(`expected ${reason}, got a Document`);
	}
	expect(outcome.reason).toBe(reason);
	return outcome;
}

export const blocksOf = (outcome: ParseOutcome): Block[] =>
	expectSuccess(outcome).document.blocks;

/** The text of each text-bearing block, in order. */
export const textsOf = (outcome: ParseOutcome): string[] =>
	blocksOf(outcome).map((block) =>
		block.kind === "image-placeholder" ? block.alt : block.text,
	);

export const firstBlock = (outcome: ParseOutcome): Block => {
	const block = blocksOf(outcome)[0];
	if (!block) throw new Error("no blocks");
	return block;
};

export type { Document };
