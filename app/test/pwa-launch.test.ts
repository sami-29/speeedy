import { describe, expect, it } from "vitest";
import {
	consumeLaunchFiles,
	type LaunchParams,
} from "../src/lib/pwa/launch.ts";

const queue = () => {
	let consumer: ((params: LaunchParams) => unknown) | undefined;
	return {
		setConsumer(fn: (params: LaunchParams) => unknown) {
			consumer = fn;
		},
		launch: (params: LaunchParams) => consumer?.(params),
	};
};

const handle = (file: File) => ({ getFile: async () => file });

describe("consumeLaunchFiles", () => {
	it("opens the first file the OS launched the app with", async () => {
		const q = queue();
		const opened: File[] = [];
		consumeLaunchFiles(q, (file) => opened.push(file));
		const first = new File(["one"], "one.txt");
		await q.launch({
			files: [handle(first), handle(new File(["two"], "two.txt"))],
		});
		expect(opened).toEqual([first]);
	});

	it("ignores a launch with no files", async () => {
		const q = queue();
		const opened: File[] = [];
		consumeLaunchFiles(q, (file) => opened.push(file));
		await q.launch({ files: [] });
		await q.launch({});
		expect(opened).toEqual([]);
	});

	it("does nothing where the browser has no launch queue", () => {
		expect(() => consumeLaunchFiles(undefined, () => {})).not.toThrow();
	});

	it("survives a file handle that cannot be read", async () => {
		const q = queue();
		const opened: File[] = [];
		consumeLaunchFiles(q, (file) => opened.push(file));
		await q.launch({
			files: [
				{
					getFile: async () => {
						throw new Error("permission denied");
					},
				},
			],
		});
		expect(opened).toEqual([]);
	});
});
