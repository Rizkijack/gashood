import { create } from 'zustand'
import { TxType, type ClassifiedTransaction } from '@/data/tx-classifier'
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

  updateMetrics: (txs: ClassifiedTransaction[], blockNumber: number, currentGasPriceWei?: bigint) => void
  /** Alias sesuai penamaan dokumen (BUILD_STEPS.md Langkah 9) — logika sama dengan updateMetrics. */
  updateFromBlock: (txs: ClassifiedTransaction[], blockNumber: number, currentGasPriceWei?: bigint) => void
  selectType: (type: TxType | null) => void
  hoverType: (type: TxType | null) => void
  clearSelection: () => void
  setTimeRange: (range: TimeRange) => void
  setCollecting: (collecting: boolean) => void
  setError: (error: string | null) => void
  clearRecentTxs: () => void
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
  },
  selectedType: null,
  hoveredType: null,
  timeRange: '5m',
  isCollecting: false,
  error: null,

  updateMetrics: (txs, blockNumber, currentGasPriceWei) => {
    const { gasMetrics, recentTxs } = get()

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

    // currentGasPrice dari eth_gasPrice (getGasPrice) — bukan dari
    // txs[0].effectiveGasPrice yang menyesatkan (audit B2/security).
    const currentGasPrice =
      currentGasPriceWei !== undefined && currentGasPriceWei > 0n
        ? weiToGwei(currentGasPriceWei)
        : prevStats.currentGasPrice

    set({
      gasMetrics: newMetrics,
      recentTxs: updatedTxs,
      networkStats: {
        currentGasPrice,
        avgBlockGas,
        tps,
        totalTransactions: prevStats.totalTransactions + txs.length,
        lastBlockNumber: blockNumber,
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
  clearRecentTxs: () => set({ recentTxs: [] }),
}))
