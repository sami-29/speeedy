export const DEFAULT_TRUSTED_ORIGINS: readonly string[] = [];

export function parseTrustedOrigins(_raw: string | undefined): string[] {
	return [...DEFAULT_TRUSTED_ORIGINS];
}
