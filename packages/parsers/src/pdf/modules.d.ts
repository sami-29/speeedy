// pdf.js ships types for its API but not for its worker file.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";

// Vite turns this import into the URL of the emitted file.
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url" {
	const url: string;
	export default url;
}
