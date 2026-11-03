import { m } from "#lib/paraglide/messages.js";

type Message = (inputs?: Record<string, string | number>) => string;

/**
 * Looks a message up by its key. The /learn structure in articles.ts names messages by key,
 * and the unit tests check that every key has a message, so a miss here is a bug.
 */
export function say(
	key: string,
	inputs?: Record<string, string | number>,
): string {
	const message = (m as unknown as Record<string, Message | undefined>)[key];
	if (!message) throw new Error(`No message for "${key}"`);
	return message(inputs);
}
