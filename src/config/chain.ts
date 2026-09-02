export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: "Robinhood Chain",
  rpcUrl: import.meta.env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/",
  blockExplorer: "https://robinhoodchain.blockscout.com",
  blockscoutApi: import.meta.env.VITE_BLOCKSCOUT_API_URL || "https://robinhoodchain.blockscout.com/api/v2",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockTime: 100,
} as const

export type ChainConfig = typeof ROBINHOOD_CHAIN
