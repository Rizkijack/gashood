import { create } from 'zustand'
import { TxType, type ClassifiedTransaction } from '@/data/tx-classifier'
import type { GasSnapshot } from '@/data/snapshot-aggregate'
import { weiToGwei, weiToEth } from '@/utils/gas-math'
import { ROBINHOOD_CHAIN } from '@/config/chain'

export interface GasMetric {
  txType: TxType
  avgGasUsed: number
  avgGasPrice: number
  minGasPrice: number
  maxGasPrice: number
  totalTxCount: number
  recentTxCount: number
  totalFeeEth: number
  trend: 'up' | 'down' | 'stable'
}

export interface NetworkStats {
  currentGasPrice: number
  avgBlockGas: number
  tps: number
  totalTransactions: number
  lastBlockNumber: number
  /** Harga 1 ETH dalam USD (Blockscout /stats coin_price). null = belum tersedia → UI sembunyikan bagian USD. */
  ethUsdPrice: number | null
}

export type TimeRange = '1m' | '5m' | '15m' | '1h'

export interface GasStore {
  gasMetrics: Map<TxType, GasMetric>
  recentTxs: ClassifiedTransaction[]
  networkStats: NetworkStats
  selectedType: TxType | null
  hoveredType: TxType | null
  timeRange: TimeRange
  isCollecting: boolean
  error: string | null
  /** Kegagalan polling beruntun (increment saat cycle gagal, reset saat sukses). */
  consecutiveFailures: number
  /**
   * Harga gas real-time (Gwei) dari Blockscout gas tracker (gas_prices.average,
   * sama dengan halaman /gas-tracker) — SUMBER UTAMA currentGasPrice.
   * null = poll Blockscout belum sukses → fallback ke eth_gasPrice RPC.
   */
  blockscoutGasPrice: number | null

  updateMetrics: (txs: ClassifiedTransaction[], blockNumber: number, currentGasPriceWei?: bigint) => void
  /** Alias sesuai penamaan dokumen (BUILD_STEPS.md Langkah 9) — logika sama dengan updateMetrics. */
  updateFromBlock: (txs: ClassifiedTransaction[], blockNumber: number, currentGasPriceWei?: bigint) => void
  selectType: (type: TxType | null) => void
  hoverType: (type: TxType | null) => void
  clearSelection: () => void
  setTimeRange: (range: TimeRange) => void
  setCollecting: (collecting: boolean) => void
  setError: (error: string | null) => void
  setConsecutiveFailures: (count: number) => void
  setEthUsdPrice: (price: number | null) => void
  setBlockscoutGasPrice: (gwei: number | null) => void
  clearRecentTxs: () => void
  /**
   * Hydrate dari snapshot git-scraper 24 jam (lihat data/snapshots.json).
   * HANYA menulis saat store masih kosong — tidak pernah menimpa data live.
   */
  seedFromSnapshot: (snapshot: GasSnapshot) => void
}

function parseMaxRecentTxs(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '')
  return Number.isNaN(parsed) || parsed <= 0 ? 200 : parsed
}

const MAX_RECENT_TXS = parseMaxRecentTxs(import.meta.env.VITE_MAX_RECENT_TXS)

/**
 * Akumulator harga non-nol per tipe (state internal agregasi, non-reaktif).
 * Avg harga hanya dihitung dari tx dengan effectiveGasPrice > 0 agar tx
 * tanpa receipt (harga 0) tidak meracuni rata-rata (audit B1).
 */
const priceAccumulator = new Map<TxType, { sumGwei: number; count: number }>()

/**
 * Skeleton metrik awal — di-generate dari `Object.values(TxType)` sehingga
 * OTOMATIS mengikuti jumlah kategori (refactor 12 → 4: NATIVE_TRANSFER,
 * ERC20_TRANSFER, SWAP, BRIDGE). Catatan deploy: key Map metrics berganti
 * (kategori lama hilang, SWAP/BRIDGE baru) → metrik in-memory ter-reset;
 * acceptable karena store tidak punya persistensi.
 */
const createInitialMetrics = (): Map<TxType, GasMetric> => {
  const metrics = new Map<TxType, GasMetric>()
  for (const type of Object.values(TxType)) {
    metrics.set(type, {
      txType: type,
      avgGasUsed: 0,
      avgGasPrice: 0,
      minGasPrice: Infinity,
      maxGasPrice: 0,
      totalTxCount: 0,
      recentTxCount: 0,
      totalFeeEth: 0,
      trend: 'stable',
    })
  }
  return metrics
}

export const useGasStore = create<GasStore>((set, get) => ({
  gasMetrics: createInitialMetrics(),
  recentTxs: [],
  networkStats: {
    currentGasPrice: 0,
    avgBlockGas: 0,
    tps: 0,
    totalTransactions: 0,
    lastBlockNumber: 0,
    ethUsdPrice: null,
  },
  selectedType: null,
  hoveredType: null,
  timeRange: '5m',
  isCollecting: false,
  error: null,
  consecutiveFailures: 0,
  blockscoutGasPrice: null,

  updateMetrics: (txs, blockNumber, currentGasPriceWei) => {
    const { gasMetrics, recentTxs, blockscoutGasPrice } = get()

    const newMetrics = new Map(gasMetrics)

    // recentTxCount = semantik "window terakhir": hitung dari batch terbaru
    // per tipe, bukan kloning totalTxCount (audit B1).
    const batchCount = new Map<TxType, number>()
    for (const tx of txs) {
      batchCount.set(tx.txType, (batchCount.get(tx.txType) ?? 0) + 1)
    }

    txs.forEach((tx) => {
      const existing = newMetrics.get(tx.txType)
      if (!existing) return

      const priceGwei = weiToGwei(tx.effectiveGasPrice)
      const feeEth = weiToEth(tx.fee)
      const gasUsed = Number(tx.gasUsed)

      const totalCount = existing.totalTxCount + 1
      const newAvgGasUsed = (existing.avgGasUsed * existing.totalTxCount + gasUsed) / totalCount

      // Skip harga 0 dari agregasi min/avg (audit B1).
      const priced = priceGwei > 0
      if (priced) {
        const acc = priceAccumulator.get(tx.txType) ?? { sumGwei: 0, count: 0 }
        acc.sumGwei += priceGwei
        acc.count += 1
        priceAccumulator.set(tx.txType, acc)
      }
      const priceAcc = priceAccumulator.get(tx.txType)
      const newAvgGasPrice = priceAcc && priceAcc.count > 0 ? priceAcc.sumGwei / priceAcc.count : existing.avgGasPrice

      newMetrics.set(tx.txType, {
        ...existing,
        avgGasUsed: newAvgGasUsed,
        avgGasPrice: newAvgGasPrice,
        minGasPrice: priced ? Math.min(existing.minGasPrice, priceGwei) : existing.minGasPrice,
        maxGasPrice: priced ? Math.max(existing.maxGasPrice, priceGwei) : existing.maxGasPrice,
        totalTxCount: totalCount,
        recentTxCount: batchCount.get(tx.txType) ?? 0,
        totalFeeEth: existing.totalFeeEth + feeEth,
        trend: priced && priceGwei > existing.avgGasPrice ? 'up' : priced && priceGwei < existing.avgGasPrice ? 'down' : 'stable',
      })
    })

    const updatedTxs = [...txs, ...recentTxs].slice(0, MAX_RECENT_TXS)

    const totalGas = txs.reduce((sum, tx) => sum + Number(tx.gasUsed), 0)
    const avgBlockGas = txs.length > 0 ? totalGas / txs.length : 0

    const prevStats = get().networkStats

    // tps = transaksi per DETIK, bukan per block (audit B9).
    const blockTimeSec = ROBINHOOD_CHAIN.blockTime / 1000
    const tps = blockTimeSec > 0 ? txs.length / blockTimeSec : txs.length

    // currentGasPrice — SUMBER UTAMA: Blockscout gas tracker (gas_prices.average
    // dari /stats, halaman /gas-tracker; di-poll 1×/60s lewat
    // refreshEthPriceIfDue). Fallback: eth_gasPrice (getGasPrice) — bukan dari
    // txs[0].effectiveGasPrice yang menyesatkan (audit B2/security) — dipakai
    // selama Blockscout belum sukses (blockscoutGasPrice masih null).
    const rpcGasPrice =
      currentGasPriceWei !== undefined && currentGasPriceWei > 0n
        ? weiToGwei(currentGasPriceWei)
        : prevStats.currentGasPrice
    const currentGasPrice = blockscoutGasPrice ?? rpcGasPrice

    set({
      gasMetrics: newMetrics,
      recentTxs: updatedTxs,
      networkStats: {
        currentGasPrice,
        avgBlockGas,
        tps,
        totalTransactions: prevStats.totalTransactions + txs.length,
        lastBlockNumber: blockNumber,
        // Harga ETH di-set terpisah (throttle 60s) — pertahankan antar update block.
        ethUsdPrice: prevStats.ethUsdPrice,
      },
    })
  },

  updateFromBlock: (txs, blockNumber, currentGasPriceWei) => {
    get().updateMetrics(txs, blockNumber, currentGasPriceWei)
  },

  selectType: (type) => set({ selectedType: type }),
  hoverType: (type) => set({ hoveredType: type }),
  clearSelection: () => set({ selectedType: null }),
  setTimeRange: (range) => set({ timeRange: range }),
  setCollecting: (collecting) => set({ isCollecting: collecting }),
  setError: (error) => set({ error }),
  setConsecutiveFailures: (count) => set({ consecutiveFailures: count }),
  setEthUsdPrice: (price) => set((s) => ({ networkStats: { ...s.networkStats, ethUsdPrice: price } })),
  // Hanya ditulis bila nilai valid (guard di gas-collector) — null berarti
  // belum ada data Blockscout, jangan menimpa nilai RPC fallback yang tampil.
  // Guard ini menegakkan kontrak "sticky": null tidak pernah menimpa nilai.
  setBlockscoutGasPrice: (gwei) => {
    if (gwei === null) return
    set({ blockscoutGasPrice: gwei })
  },
  clearRecentTxs: () => set({ recentTxs: [] }),

  /**
   * Hydrate store dari snapshot git-scraper 24 jam (data/snapshots.json —
   * di-commit GitHub Actions tiap ±1 jam, lihat .github/workflows/collect.yml).
   * Tujuan: saat situs baru dibuka, UI & grafik tidak mulai dari kosong.
   *
   * Guard anti-timpa (audit C1): seed HANYA berjalan bila store masih
   * kosong — metrics kosong (semua avgGasPrice 0) DAN totalTransactions
   * masih 0. Kedua field itu selalu di-set bersamaan oleh
   * updateMetrics/updateFromBlock, jadi begitu ada data live apa pun guard
   * langsung skip snapshot riwayat.
   *
   * Catatan: guard TIDAK lagi memakai isCollecting. Hydrate yang memanggil
   * seedFromSnapshot berjalan async (fetch) dan selesai SETELAH mount
   * menjalankan startCollecting() → isCollecting selalu true saat seed
   * dipanggil, sehingga lama-kelamaan fitur seed tak pernah jalan (dead code).
   * Pengecekan kekosongan yang sesungguhnya (isEmpty + totalTransactions)
   * sudah cukup melindungi dari menimpa data live.
   */
  seedFromSnapshot: (snapshot) => {
    const { gasMetrics, networkStats } = get()

    const isEmpty =
      networkStats.totalTransactions === 0 &&
      Array.from(gasMetrics.values()).every((m) => m.avgGasPrice === 0)
    if (!isEmpty) return

    const seededMetrics = new Map(gasMetrics)
    for (const [type, metric] of seededMetrics) {
      const cat = snapshot.categories[type]
      if (!cat) continue // kategori tak ada di snapshot → biarkan nilai awal
      seededMetrics.set(type, {
        ...metric,
        avgGasUsed: cat.avgGasUsed,
        avgGasPrice: cat.avgGasPrice,
        minGasPrice: cat.minGasPrice,
        maxGasPrice: cat.maxGasPrice,
        totalTxCount: cat.totalTxCount,
        // recentTxCount = window live — riwayat bukan data live, biarkan 0.
        recentTxCount: 0,
        totalFeeEth: cat.totalFeeEth,
        // trend = metrik real-time — snapshot statis selalu 'stable'.
        trend: 'stable',
      })
    }

    set({
      gasMetrics: seededMetrics,
      networkStats: {
        ...networkStats,
        currentGasPrice: snapshot.gasPriceGwei,
        tps: snapshot.tps,
        lastBlockNumber: snapshot.block,
        // totalTransactions ikut di-seed: Dashboard memakai ini sebagai
        // penanda hasData — tanpa ini stats ter-seed tetap tampil "—".
        totalTransactions: Object.values(snapshot.categories).reduce((sum, cat) => sum + cat.totalTxCount, 0),
      },
    })
  },
}))
