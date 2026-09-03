import { TxType } from "@/data/tx-classifier";

/**
 * Shared city layout for GasHood.
 *
 * Mirrors the grid used inside GasCity (4 cols × 3 rows, spacing 60 units,
 * centered at origin) so CameraFocus can compute building positions without
 * importing/relying on GasCity internals.
 *
 * IMPORTANT: keep in sync with GasCity's local constants (GasCity is owned by
 * another workstream and must not be edited here).
 *
 * CITY_SCALE — TUNGGAL sumber rescale kota (rasio gedung vs mobil realistis:
 * mobil ~1.5 m vs gedung 30–100+ m). Semua dimensi/posisi SKALA-KOTA wajib
 * derive dari sini; objek skala-mobil/lingkungan-kecil (ukuran mobil, lebar
 * lajur, pohon, partikel) TIDAK ikut dikalikan. Ganti nilainya (mis. 10/12)
 * untuk tune ulang seluruh kota dari satu tempat.
 */
export const CITY_SCALE = 15;
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

// Grid pitch: 4 unit dasar × CITY_SCALE — baris z∈{-60,0,60}, kolom x∈{-90,-30,30,90}.
export const SPACING = 4 * CITY_SCALE;

/** Koridor sungai DataRiver: tepat di tengah antara baris z=0 dan z=SPACING. */
export const RIVER_Z = SPACING / 2;

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

/**
 * Tinggi gedung (world units) dari avgGasUsed — SATU sumber rumus.
 * WORKFLOW.md 2.4: normalize(avgGasUsed, 0, 200_000) * 7.5 + 0.5, lalu
 * ×CITY_SCALE. GasBuilding (visual) & GasParticles (spawn) WAJIB import
 * fungsi ini — jangan duplikasi angka (divergensi 200_000 vs 300_000 pernah
 * membuat partikel spawn di dalam menara).
 */
export function buildingHeight(avgGasUsed: number): number {
  return (Math.min(avgGasUsed / 200_000, 1) * 7.5 + 0.5) * CITY_SCALE;
}
