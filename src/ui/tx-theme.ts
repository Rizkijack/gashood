import { TxType } from "@/data/tx-classifier";

/**
 * Tema per-kategori-transaksi (refactor 12 → 4 kategori) shared by the
 * Fase 4 UI overlay.
 * Warna warisan: SWAP memakai warna eks DEX_SWAP, BRIDGE memakai warna
 * eks BRIDGE_DEPOSIT; NATIVE_TRANSFER & ERC20_TRANSFER tetap.
 * Colors match the particle colors from docs/3D_DESIGN.md ("Warna per tipe transaksi").
 */
export const TX_COLORS: Record<TxType, string> = {
  [TxType.NATIVE_TRANSFER]: "#4FC3F7",
  [TxType.ERC20_TRANSFER]: "#81C784",
  [TxType.SWAP]: "#FFD54F", // warisan eks DEX_SWAP
  [TxType.BRIDGE]: "#CE93D8", // warisan eks BRIDGE_DEPOSIT
};

export const TX_LABELS: Record<TxType, string> = {
  [TxType.NATIVE_TRANSFER]: "Native Transfer",
  [TxType.ERC20_TRANSFER]: "ERC-20 Transfer",
  [TxType.SWAP]: "Swap",
  [TxType.BRIDGE]: "Bridge",
};

/** Canonical display order (matches GasCity row + store map insertion order). */
export const TX_ORDER: TxType[] = [
  TxType.NATIVE_TRANSFER,
  TxType.ERC20_TRANSFER,
  TxType.SWAP,
  TxType.BRIDGE,
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
  { min: 1.0, color: "#FF2244", label: "≥1.0" },
];
