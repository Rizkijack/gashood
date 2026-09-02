import { TxType } from "@/data/tx-classifier";

/**
 * Per-transaction-type theme constants shared by the Fase 4 UI overlay.
 * Colors match the particle colors from docs/3D_DESIGN.md ("Warna per tipe transaksi").
 */
export const TX_COLORS: Record<TxType, string> = {
  [TxType.NATIVE_TRANSFER]: "#4FC3F7",
  [TxType.ERC20_TRANSFER]: "#81C784",
  [TxType.ERC20_APPROVE]: "#AED581",
  [TxType.DEX_SWAP]: "#FFD54F",
  [TxType.LIQUIDITY]: "#FF8A65",
  [TxType.BRIDGE_DEPOSIT]: "#CE93D8",
  [TxType.BRIDGE_WITHDRAW]: "#B39DDB",
  [TxType.NFT_TRANSFER]: "#F48FB1",
  [TxType.NFT_MINT]: "#EF5350",
  [TxType.CONTRACT_DEPLOY]: "#90A4AE",
  [TxType.CONTRACT_CALL]: "#78909C",
  [TxType.RWA_TOKEN]: "#4DD0E1",
};

export const TX_LABELS: Record<TxType, string> = {
  [TxType.NATIVE_TRANSFER]: "Native Transfer",
  [TxType.ERC20_TRANSFER]: "ERC-20 Transfer",
  [TxType.ERC20_APPROVE]: "ERC-20 Approve",
  [TxType.DEX_SWAP]: "DEX Swap",
  [TxType.LIQUIDITY]: "Liquidity",
  [TxType.BRIDGE_DEPOSIT]: "Bridge Deposit",
  [TxType.BRIDGE_WITHDRAW]: "Bridge Withdraw",
  [TxType.NFT_TRANSFER]: "NFT Transfer",
  [TxType.NFT_MINT]: "NFT Mint",
  [TxType.CONTRACT_DEPLOY]: "Contract Deploy",
  [TxType.CONTRACT_CALL]: "Contract Call",
  [TxType.RWA_TOKEN]: "RWA Token",
};

/** Canonical display order (matches GasCity grid + store map insertion order). */
export const TX_ORDER: TxType[] = [
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

export interface GasBracket {
  /** Inclusive lower bound (Gwei); undefined = -∞ */
  min?: number;
  /** Exclusive upper bound (Gwei); undefined = +∞ */
  max?: number;
  color: string;
  label: string;
}

/** Gas price color scale from docs/3D_DESIGN.md (Robinhood Chain calibrated). */
export const GAS_BRACKETS: GasBracket[] = [
  { max: 0.01, color: "#00FF88", label: "<0.01" },
  { min: 0.01, max: 0.05, color: "#44CC66", label: "0.01–0.05" },
  { min: 0.05, max: 0.1, color: "#88BB44", label: "0.05–0.1" },
  { min: 0.1, max: 0.5, color: "#CCAA22", label: "0.1–0.5" },
  { min: 0.5, max: 1.0, color: "#FF7722", label: "0.5–1.0" },
  { min: 1.0, color: "#FF2244", label: ">1.0" },
];

export function gasColor(gwei: number): string {
  for (const b of GAS_BRACKETS) {
    if ((b.min === undefined || gwei >= b.min) && (b.max === undefined || gwei < b.max)) {
      return b.color;
    }
  }
  return GAS_BRACKETS[0].color;
}
