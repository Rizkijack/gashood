/**
 * Modul murni (pure, tanpa I/O, tanpa import.meta) — SATU SUMBER logika
 * snapshot 24 jam yang dipakai TIGA pihak:
 * 1. `scripts/collect-snapshot.ts` (git-scraper Bun, GitHub Actions)
 * 2. `src/data/history-client.ts` (parser sisi frontend)
 * 3. `src/data/__tests__/history-client.test.ts` (unit test)
 *
 * TIDAK BOLEH meng-import modul yang memakai `import.meta.env` (chain.ts,
 * rpc-client.ts) — script Bun tidak punya Vite env.
 */
// Relative import (bukan alias '@/') — modul ini juga di-import oleh
// scripts/collect-snapshot.ts lewat Bun, yang membaca tsconfig root
// (solution-style, TANPA paths) sehingga alias '@/' tidak ter-resolve.
import { TxType, type ClassifiedTransaction } from './tx-classifier'
import { weiToGwei, weiToEth } from '../utils/gas-math'

/** Agregat satu kategori transaksi untuk satu window snapshot. */
export interface CategoryAggregate {
  /** Rata-rata gas used (unit gas). */
  avgGasUsed: number
  /** Rata-rata effective gas price (Gwei) — hanya dari tx ber-harga (> 0). */
  avgGasPrice: number
  /** Gas price minimum (Gwei) — 0 bila tak ada tx ber-harga. */
  minGasPrice: number
  /** Gas price maksimum (Gwei) — 0 bila tak ada tx ber-harga. */
  maxGasPrice: number
  /** Jumlah tx kategori ini dalam window (termasuk tx tanpa harga). */
  totalTxCount: number
  /** Total fee kategori ini (ETH). */
  totalFeeEth: number
}

/** Satu titik snapshot (window ~30 block ≈ beberapa detik, diambil tiap ±5 menit). */
export interface GasSnapshot {
  /** Waktu snapshot, ISO UTC (mis. "2026-09-05T08:15:00.000Z"). */
  t: string
  /** Nomor block terbaru saat snapshot. */
  block: number
  /** Harga gas jaringan saat snapshot (Gwei, dari eth_gasPrice). */
  gasPriceGwei: number
  /** Tx per detik ≈ totalTx / (jumlah block × block time). */
  tps: number
  categories: Record<TxType, CategoryAggregate>
}

/** Bentuk file `data/snapshots.json` (rolling 24 jam, ±288 titik). */
export interface SnapshotFile {
  version: 1
  updatedAt: string
  snapshots: GasSnapshot[]
}

/** Batas retensi riwayat: 288 titik × 5 menit ≈ 24 jam. */
export const MAX_SNAPSHOTS = 288
/** Umur maksimum snapshot yang dipertahankan (24 jam, ms). */
export const RETENTION_MS = 24 * 60 * 60 * 1000

export interface AggregateSnapshotInput {
  /** Tx yang sudah diklasifikasi + punya receipt (fee/gasUsed valid). */
  txs: ClassifiedTransaction[]
  /** Jumlah block dalam window — untuk hitung TPS. */
  blockCount: number
  /** Nomor block terbaru dalam window. */
  blockNumber: number
  /** Harga gas jaringan (wei, dari eth_gasPrice). */
  gasPriceWei: bigint
  /** Block time chain (ms) — sumber: ROBINHOOD_CHAIN.blockTime. */
  blockTimeMs: number
  /** Waktu snapshot (epoch ms). */
  timestampMs: number
}

/** Kategori kosong — nilai 0 (BUKAN Infinity: Infinity rusak saat JSON.stringify). */
function emptyCategory(): CategoryAggregate {
  return { avgGasUsed: 0, avgGasPrice: 0, minGasPrice: 0, maxGasPrice: 0, totalTxCount: 0, totalFeeEth: 0 }
}

/**
 * Murni: agregasi tx terklasifikasi (satu window ~N block) → GasSnapshot.
 * Konsisten dengan aturan store (audit B1): harga 0 (tx tanpa receipt valid)
 * tidak ikut rata-rata/min/max, tapi tetap dihitung di totalTxCount.
 */
export function aggregateSnapshot(input: AggregateSnapshotInput): GasSnapshot {
  const { txs, blockCount, blockNumber, gasPriceWei, blockTimeMs, timestampMs } = input

  const categories = Object.fromEntries(
    Object.values(TxType).map((type) => [type, emptyCategory()]),
  ) as Record<TxType, CategoryAggregate>

  // Akumulator harga per kategori — avg hanya dari tx ber-harga (> 0).
  const priceAcc = new Map<TxType, { sum: number; count: number }>()
  const gasUsedAcc = new Map<TxType, { sum: number; count: number }>()

  for (const tx of txs) {
    const cat = categories[tx.txType]
    if (!cat) continue // guard defensif: kategori tak dikenal → abaikan

    cat.totalTxCount += 1
    cat.totalFeeEth += weiToEth(tx.fee)

    const gasUsed = Number(tx.gasUsed)
    const gasAcc = gasUsedAcc.get(tx.txType) ?? { sum: 0, count: 0 }
    gasAcc.sum += gasUsed
    gasAcc.count += 1
    gasUsedAcc.set(tx.txType, gasAcc)

    const priceGwei = weiToGwei(tx.effectiveGasPrice)
    if (priceGwei > 0) {
      const acc = priceAcc.get(tx.txType) ?? { sum: 0, count: 0 }
      acc.sum += priceGwei
      acc.count += 1
      priceAcc.set(tx.txType, acc)
    }
  }

  // Turunkan akumulator → avg/min/max. Kategori tanpa tx ber-harga → 0.
  for (const type of Object.values(TxType)) {
    const cat = categories[type]
    const prices = priceAcc.get(type)
    const gas = gasUsedAcc.get(type)
    if (prices && prices.count > 0) {
      const list: number[] = []
      for (const tx of txs) {
        if (tx.txType !== type) continue
        const p = weiToGwei(tx.effectiveGasPrice)
        if (p > 0) list.push(p)
      }
      cat.avgGasPrice = prices.sum / prices.count
      cat.minGasPrice = Math.min(...list)
      cat.maxGasPrice = Math.max(...list)
    }
    if (gas && gas.count > 0) {
      cat.avgGasUsed = gas.sum / gas.count
    }
  }

  const blockTimeSec = blockTimeMs / 1000
  const windowSec = blockCount > 0 ? blockCount * blockTimeSec : 0

  return {
    t: new Date(timestampMs).toISOString(),
    block: blockNumber,
    gasPriceGwei: weiToGwei(gasPriceWei),
    tps: windowSec > 0 ? txs.length / windowSec : 0,
    categories,
  }
}

/**
 * Murni: gabungkan riwayat lama + snapshot baru → urut naik, dedupe by
 * `block` (snapshot BARU menang bila block sama), buang yang > 24 jam,
 * lalu cap ±288 titik (ambil yang TERBARU).
 */
export function mergeSnapshots(existing: GasSnapshot[], fresh: GasSnapshot[], nowMs: number): GasSnapshot[] {
  const byBlock = new Map<number, GasSnapshot>()

  // Lama dulu, lalu fresh menimpa bila block sama (data segar lebih akurat).
  for (const snap of existing) {
    byBlock.set(snap.block, snap)
  }
  for (const snap of fresh) {
    byBlock.set(snap.block, snap)
  }

  const cutoff = nowMs - RETENTION_MS
  return Array.from(byBlock.values())
    .filter((snap) => {
      const t = Date.parse(snap.t)
      return Number.isFinite(t) && t >= cutoff
    })
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .slice(-MAX_SNAPSHOTS)
}
