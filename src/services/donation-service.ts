export interface DonationWallet {
	chain: string;
	label: string;
	address: string;
	explorerUrl: string;
	symbol: string;
}

export interface Supporter {
	address: string;
	name: string;
	amount: string;
	chain: string;
	txHash: string;
	date: string;
}

export const DONATION_WALLETS: DonationWallet[] = [
	{
		chain: "ETH",
		label: "Ethereum",
		symbol: "ETH",
		address: "0xbf76261d8ce29c511ed31ca63b4a82454e4e2a47",
		explorerUrl:
			"https://etherscan.io/address/0xbf76261d8ce29c511ed31ca63b4a82454e4e2a47",
	},
	{
		chain: "BNB",
		label: "USDT (BNB Smart Chain - BEP20)",
		symbol: "USDT",
		address: "0xbf76261d8ce29c511ed31ca63b4a82454e4e2a47",
		explorerUrl:
			"https://bscscan.com/address/0xbf76261d8ce29c511ed31ca63b4a82454e4e2a47",
	},
	{
		chain: "BNB",
		label: "USDC (BNB Smart Chain - BEP20)",
		symbol: "USDC",
		address: "0xbf76261d8ce29c511ed31ca63b4a82454e4e2a47",
		explorerUrl:
			"https://bscscan.com/address/0xbf76261d8ce29c511ed31ca63b4a82454e4e2a47",
	},
	{
		chain: "SOL",
		label: "Solana",
		symbol: "SOL",
		address: "FxdrWE9QLy4V1rjbcAmqnhNafuUFqsDC2ytbAKXjRimU",
		explorerUrl:
			"https://solscan.io/account/FxdrWE9QLy4V1rjbcAmqnhNafuUFqsDC2ytbAKXjRimU",
	},
	{
		chain: "BTC",
		label: "Bitcoin",
		symbol: "BTC",
		address: "1Lwgn5bYNMHm1x3ACx5oLPk1GEnLVZhAi7",
		explorerUrl:
			"https://mempool.space/address/1Lwgn5bYNMHm1x3ACx5oLPk1GEnLVZhAi7",
	},
];

/** Verified supporters; append entries after confirming TX with the donor. */
export const SUPPORTERS: Supporter[] = [];
