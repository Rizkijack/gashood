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

/* ==== Tinggi gedung = gauge gas price real-time =========================== */

/**
 * Konversi rasio user: **1 Gwei = 50 m** tinggi gedung. Skala dunia 1 unit ≈
 * 4.5 m (mobil 1.0 unit ≈ 4.5 m) → 1 Gwei ≈ 11.11 unit tinggi. Linear murni
 * proporsional — TANPA normalisasi min/max seperti rumus avgGasUsed lama:
 * skyline membaca harga jaringan, bukan aktivitas per kategori.
 */
export const HEIGHT_UNITS_PER_GWEI = 50 / 4.5;

/** Idle/tidak ada data harga (avgGasPrice 0/NaN/negatif) — 7.5 unit,
 * kesinambungan dengan lantai terendah sistem fasad lama. */
export const MIN_BUILDING_HEIGHT = 7.5;

/** Batas atas 150 unit ≈ 675 m @ ~13.5 Gwei — headroom jelas di atas rentang
 * gas price normal, spike ekstrem tetap terbaca tanpa menembus langit. */
export const MAX_BUILDING_HEIGHT = 150;

/**
 * Tinggi gedung (world units) dari avgGasPrice (Gwei) — SATU sumber rumus.
 * Tinggi = gauge gas price real-time; sumber nilai = Blockscout gas tracker
 * (sudah ter-wire ke store). GasBuilding (visual) & GasParticles (spawn)
 * WAJIB import fungsi ini — jangan duplikasi angka (divergensi dulu pernah
 * membuat partikel spawn di dalam menara).
 */
export function buildingHeight(avgGasPriceGwei: number): number {
  // Input invalid (NaN) atau ≤ 0 → MIN (NaN gagal semua perbandingan numerik).
  if (!(avgGasPriceGwei > 0)) return MIN_BUILDING_HEIGHT;
  const raw = avgGasPriceGwei * HEIGHT_UNITS_PER_GWEI;
  return Math.min(Math.max(raw, MIN_BUILDING_HEIGHT), MAX_BUILDING_HEIGHT);
}
