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
scope.onmessage = (event) => {
	for (const reply of session.handle(event.data)) scope.postMessage(reply);
};
