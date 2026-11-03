export type Theme = "paper" | "night";

export const THEME_STORAGE_KEY = "speeedy.theme";

export const parseTheme = (value: string | null | undefined): Theme =>
	value === "night" ? "night" : "paper";

export const applyTheme = (
	root: { dataset: Record<string, string | undefined> },
	theme: Theme,
): void => {
	root.dataset.theme = theme;
};
