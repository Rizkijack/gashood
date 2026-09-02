import { TxType } from "@/data/tx-classifier";

/**
 * Shared city layout for GasHood.
 *
 * Mirrors the grid used inside GasCity (4 cols × 3 rows, spacing 4 units,
 * centered at origin) so CameraFocus can compute building positions without
 * importing/relying on GasCity internals.
 *
 * IMPORTANT: keep in sync with GasCity's local constants (GasCity is owned by
 * another workstream and must not be edited here).
 */
export const TX_TYPES_ORDERED: TxType[] = [
  TxType.NATIVE_TRANSFER,
  TxType.ERC20_TRANSFER,
  TxType.ERC20_APPROVE,
  TxType.DEX_SWAP,
  TxType.LIQUIDITY,
  TxType.BRIDGE_DEPOSIT,
  TxType.BRIDGE_WITHDRAW,
  TxType.NFT_TRANSFER,
  TxType.NFT_MINT,
  TxType.CONTRACT_DEPLOY,
  TxType.CONTRACT_CALL,
  TxType.RWA_TOKEN,
];

export const SPACING = 4;

export function indexToPosition(index: number): [number, number, number] {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const x = (col - 1.5) * SPACING;
  const z = (row - 1) * SPACING;
  return [x, 0, z];
}

export function getBuildingPosition(txType: TxType): [number, number, number] {
  const index = TX_TYPES_ORDERED.indexOf(txType);
  if (index === -1) return [0, 0, 0];
  return indexToPosition(index);
}
