import type { Handle } from "@sveltejs/kit/hooks";
import { withLegacyScript } from "#lib/legacy/inline.ts";
import { paraglideMiddleware } from "#lib/paraglide/server.js";

const NOINDEX = '<meta name="robots" content="noindex" />';

// Runs at build time to prerender, not on a server. It sets the page language and puts
// `noindex` into the HTML of every client-only app route (and the fallback page), because
// those shells have no server-rendered <svelte:head> to carry it.
export const handle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ locale }) => {
		const appRoute = !event.route.id || event.route.id.startsWith("/(app)");
		return resolve(event, {
			transformPageChunk: ({ html }) =>
				withLegacyScript(html, event.url.pathname)
					.replace("%paraglide.lang%", locale)
					.replace("</head>", appRoute ? `${NOINDEX}</head>` : "</head>"),
		});
	});
