export function calculateTotalFee(gasUsed: bigint, effectiveGasPrice: bigint): bigint {
  return gasUsed * effectiveGasPrice
}

export function weiToGwei(wei: bigint): number {
  return Number(wei) / 1e9
}

export function weiToEth(wei: bigint): number {
  return Number(wei) / 1e18
}

export function gweiToEth(gwei: number): number {
  return gwei / 1e9
}

export function ethToUsd(eth: number, ethPrice: number): number {
  return eth * ethPrice
}
