import { TxType } from "@/data/tx-classifier";

/**
 * Shared city layout for GasHood.
 *
 * Refactor 12 → 4 kategori: 4 gedung kini berdiri dalam SATU baris tengah
 * z=0 (x = (i − 1.5) × SPACING → x ∈ {−90, −30, 30, 90} @ SPACING=60) —
 * simetris terhadap plaza. GasCity, GasParticles & CameraFocus membaca
 * posisi lewat helper di file ini — satu sumber kebenaran.
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
/** Refactor 12 → 4 kategori: NATIVE_TRANSFER, ERC20_TRANSFER, SWAP, BRIDGE. */
export const TX_TYPES_ORDERED: TxType[] = [
  TxType.NATIVE_TRANSFER,
  TxType.ERC20_TRANSFER,
  TxType.SWAP,
  TxType.BRIDGE,
];

// Grid pitch: 4 unit dasar × CITY_SCALE (60) — jarak antar gedung satu baris.
export const SPACING = 4 * CITY_SCALE;

/** Koridor sungai DataRiver: z=30 (utara baris gedung, warisan grid 4×3). */
export const RIVER_Z = SPACING / 2;

/**
 * Posisi gedung ke-i (refactor 12 → 4 kategori — grid 4×3 lama tidak berlaku):
 * 4 gedung dalam 1 baris tengah z=0, x = (i − 1.5) × SPACING →
 * {−90, −30, 30, 90} — simetris terhadap plaza. RIVER_Z (z=30) & RoadNetwork
 * tidak berubah — sungai/jalan tidak menabrak baris z=0.
 */
export function indexToPosition(index: number): [number, number, number] {
  const x = (index - 1.5) * SPACING;
  return [x, 0, 0];
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

/** Gedung idle/tidak ada data harga (avgGasPrice 0/NaN/negatif) — 7.5 unit.
 * Sekaligus titik anchor bawah gauge: gas 0.1 Gwei dipetakan ke nilai ini
 * (lihat GAS_ANCHOR_GWEI). */
export const MIN_BUILDING_HEIGHT = 7.5;

/** Batas atas 150 unit ≈ 675 m — headroom jelas untuk spike ekstrem. */
export const MAX_BUILDING_HEIGHT = 150;

/** Gas price (Gwei) yang dipetakan ke MIN_BUILDING_HEIGHT. Re-anchor ke range
 * nyata Robinhood (gas typ ~0.1–0.5 Gwei, bukan rentang Ethereum mainnet 10–50
 * Gwei) agar skyline tidak rata ter-patok di floor selama harga normal. Di atas
 * anchor, tinggi naik linear @ HEIGHT_UNITS_PER_GWEI. */
export const GAS_ANCHOR_GWEI = 0.1;

/**
 * Tinggi gedung (world units) dari avgGasPrice (Gwei) — SATU sumber rumus.
 * Re-anchor: 0.1 Gwei → MIN_BUILDING_HEIGHT, naik linear (slope = 1 Gwei per
 * HEIGHT_UNITS_PER_GWEI ≈ 50 m), clamp ke [MIN, MAX]. Sumber nilai = Blockscout
 * gas tracker (sudah ter-wire ke store). GasBuilding (visual) & GasParticles
 * (spawn) WAJIB import fungsi ini — jangan duplikasi angka (divergensi dulu
 * pernah membuat partikel spawn di dalam menara).
 */
export function buildingHeight(avgGasPriceGwei: number): number {
  // Input invalid (NaN) atau ≤ 0 → MIN (NaN gagal semua perbandingan numerik).
  if (!(avgGasPriceGwei > 0)) return MIN_BUILDING_HEIGHT;
  const raw = MIN_BUILDING_HEIGHT + (avgGasPriceGwei - GAS_ANCHOR_GWEI) * HEIGHT_UNITS_PER_GWEI;
  return Math.min(Math.max(raw, MIN_BUILDING_HEIGHT), MAX_BUILDING_HEIGHT);
}
