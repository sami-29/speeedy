import source from "./hash-map.js?raw";

// The mapper, as inline script text. It sits first in the landing page's <head>, so it runs
// before the app's scripts and so before any analytics: a 1.x link is replaced before the old
// page can report itself. It is the same file the unit tests import, with its comments and its
// `export` keyword removed.
//
// A 1.x route on another path is replaced with `location.replace`, so Back does not return to
// the 1.x hash. `#/` and unknown routes already are the landing page, so they are tidied in
// place, which does not reload. The page that is about to be replaced is marked, and
// `trackPageview` stays quiet for it. A 1.x bookmark opened in a tab that already shows the
// landing page only changes the hash, so the mapper listens for that too.
const mapper = source
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[ \t]*\/\/.*$/gm, "")
	.replace(/^export /m, "")
	.replace(/^[ \t]+/gm, "")
	.replace(/\n{2,}/g, "\n")
	.trim();

export const LEGACY_HASH_SCRIPT = `(function(){${mapper}
function go(){try{
var r=mapLegacyHash(location.hash);
if(r){if(r.path==="/"){history.replaceState(history.state,"","/")}else{document.documentElement.dataset.legacyRedirect="1";location.replace(r.path+r.hash)}}
}catch(e){}}
go();
addEventListener("hashchange",go);
})();`;

const MARKER = "<!--speeedy-legacy-hash-->";

/** Puts the mapper into the landing page's HTML, and removes its marker from every page. */
export function withLegacyScript(html: string, pathname: string): string {
	// A function, so `$` in the script is never read as a replacement pattern.
	return html.replace(MARKER, () =>
		pathname === "/" ? `<script>${LEGACY_HASH_SCRIPT}</script>` : "",
	);
}
