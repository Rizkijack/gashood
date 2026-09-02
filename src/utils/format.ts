export function formatGasPrice(gwei: number): string {
  if (gwei < 0.01) return "<0.01 Gwei"
  if (gwei < 1) return `${gwei.toFixed(2)} Gwei`
  return `${gwei.toFixed(1)} Gwei`
}

export function formatEth(eth: number): string {
  if (eth === 0) return "0 ETH"
  if (eth < 0.000001) return `${(eth * 1e9).toFixed(2)} nETH`
  if (eth < 0.001) return `${(eth * 1e6).toFixed(2)} μETH`
  if (eth < 1) return `${eth.toFixed(6)} ETH`
  return `${eth.toFixed(4)} ETH`
}

export function formatTxHash(hash: string): string {
  if (hash.length <= 10) return hash
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function formatBlockNumber(n: number): string {
  return `#${n.toLocaleString()}`
}

/**
 * Format nilai USD. Return string kosong untuk input non-finite — pemanggil
 * UI me-skip render (jangan tampil "undefined"/"NaN").
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return ""
  if (usd >= 1) return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (usd >= 0.01) return `$${usd.toFixed(4)}`
  return "$<0.01"
}
