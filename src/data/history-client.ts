/**
 * Klien riwayat 24 jam (git-scraping): baca file snapshot agregat
 * `data/snapshots.json` yang di-commit otomatis oleh GitHub Actions
 * (lihat .github/workflows/collect.yml) tiap ±1 jam.
 *
 * Kontrak fail-open: kegagalan apa pun (fetch, timeout, shape rusak) → null —
 * situs tetap hidup TANPA riwayat; live-polling RPC tidak terpengaruh.
 * Logika murni `parseSnapshots` diekspor terpisah agar mudah di-test.
 */
import type { GasSnapshot, SnapshotFile } from './snapshot-aggregate'
import { TxType } from './tx-classifier'

export type { GasSnapshot, SnapshotFile, CategoryAggregate } from './snapshot-aggregate'

/** URL snapshot — bisa di-override via VITE_SNAPSHOT_URL (mis. mirror/branch lain). */
const SNAPSHOT_URL =
  import.meta.env.VITE_SNAPSHOT_URL ??
  'https://raw.githubusercontent.com/Rizkijack/gashood/main/data/snapshots.json'

/** Timeout fetch riwayat (ms) — riwayat bukan data kritis, jangan gantung UI. */
const FETCH_TIMEOUT_MS = 8_000

/** Validasi satu CategoryAggregate: semua field number finite & >= 0. */
function isValidCategory(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  const numericFields = ['avgGasUsed', 'avgGasPrice', 'minGasPrice', 'maxGasPrice', 'totalTxCount', 'totalFeeEth']
  return numericFields.every(
    (field) => typeof c[field] === 'number' && Number.isFinite(c[field]) && c[field] >= 0,
  )
}

/** Validasi satu GasSnapshot (entry): shape + tipe primitif. Entry invalid → false (di-skip). */
function isValidSnapshot(value: unknown): value is GasSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>

  // t harus ISO yang bisa di-parse; block/gas/tps harus angka wajar.
  if (typeof s.t !== 'string' || !Number.isFinite(Date.parse(s.t))) return false
  if (typeof s.block !== 'number' || !Number.isInteger(s.block) || s.block < 0) return false
  if (typeof s.gasPriceGwei !== 'number' || !Number.isFinite(s.gasPriceGwei) || s.gasPriceGwei < 0) return false
  if (typeof s.tps !== 'number' || !Number.isFinite(s.tps) || s.tps < 0) return false

  // categories wajib memuat KEEMPAT kategori dengan field valid.
  if (typeof s.categories !== 'object' || s.categories === null) return false
  return Object.values(TxType).every((type) => isValidCategory((s.categories as Record<string, unknown>)[type]))
}

/**
 * Murni: parse hasil JSON mentah → SnapshotFile, ATAU null bila shape tidak
 * dikenali. Entry individual yang rusak di-skip (sisanya tetap dipakai);
 * bila semua entry invalid / snapshots kosong → null (tidak ada yang
 * bermanfaat untuk UI).
 */
export function parseSnapshots(json: unknown): SnapshotFile | null {
  if (typeof json !== 'object' || json === null) return null
  const file = json as Record<string, unknown>

  if (file.version !== 1) return null
  if (!Array.isArray(file.snapshots)) return null

  const snapshots = file.snapshots.filter(isValidSnapshot)
  if (snapshots.length === 0) return null

  return {
    version: 1,
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : '',
    snapshots,
  }
}

/**
 * Fetch riwayat gas 24 jam dari snapshot file (raw GitHub default).
 * Cache-bust `?t=Date.now()` supaya raw.githubusercontent (CDN) tidak
 * menyajikan cache basi. SUKSES → SnapshotFile (terurut naik by t);
 * GAGAL apa pun → null (situs tetap hidup tanpa riwayat).
 */
export async function fetchGasHistory(): Promise<SnapshotFile | null> {
  try {
    const url = `${SNAPSHOT_URL}?t=${Date.now()}`
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return null
    return parseSnapshots(await response.json())
  } catch {
    return null
  }
}
