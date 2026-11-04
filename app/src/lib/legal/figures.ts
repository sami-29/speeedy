import { PLANS } from "@speeedy/contracts";

/**
 * The Plus prices and limits the Terms quote, read from the plan data so the page cannot
 * drift from what the Worker sells. Polar is the live provider; the Stripe fallback carries
 * the same prices.
 */
export function plusFigures(): {
	monthly: string;
	annual: string;
	launch: string;
	hours: string;
	sync: string;
} {
	const { prices, limits } = PLANS.plus;
	const dollars = (cents: number): string => `$${cents / 100}`;
	return {
		monthly: dollars(prices.polar.monthly.usdCents),
		annual: dollars(prices.polar.annual.usdCents),
		launch: dollars(prices.polar.annualLaunch.usdCents),
		hours: String(limits.voiceHoursPerMonth),
		sync: `${limits.syncBytes / 1_000_000_000} GB`,
	};
}
