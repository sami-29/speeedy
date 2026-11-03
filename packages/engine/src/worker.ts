/**
 * Web Worker entry: builds the Timeline off the main thread, and rebuilds it when settings
 * change. The app starts it with `import TimelineWorker from "@speeedy/engine/worker?worker"`
 * and posts `TimelineRequest`s; each is answered with `TimelineReply`s. Playback itself
 * stays on the main thread.
 */
import {
	createTimelineSession,
	type TimelineReply,
	type TimelineRequest,
} from "./timeline-session";

type WorkerScope = {
	onmessage: ((event: { data: TimelineRequest }) => void) | null;
	postMessage(message: TimelineReply): void;
};

const scope = globalThis as unknown as WorkerScope;
const session = createTimelineSession();
// Each reply is posted as it is made, so a rebuild's first Frames leave before the rest are built.
scope.onmessage = (event) => {
	session.handle(event.data, (reply) => scope.postMessage(reply));
};
