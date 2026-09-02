import { create } from 'zustand'
import { TxType, type ClassifiedTransaction } from '@/data/tx-classifier'

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

  updateMetrics: (txs: ClassifiedTransaction[], blockNumber: number) => void
  selectType: (type: TxType | null) => void
  hoverType: (type: TxType | null) => void
  setTimeRange: (range: TimeRange) => void
  setCollecting: (collecting: boolean) => void
  setError: (error: string | null) => void
  clearRecentTxs: () => void
}

const MAX_RECENT_TXS = parseInt(import.meta.env.VITE_MAX_RECENT_TXS || '200')

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

const weiToGwei = (wei: bigint): number => Number(wei) / 1e9
const weiToEth = (wei: bigint): number => Number(wei) / 1e18

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

  updateMetrics: (txs, blockNumber) => {
    const { gasMetrics, recentTxs } = get()

    const newMetrics = new Map(gasMetrics)

    txs.forEach((tx) => {
      const existing = newMetrics.get(tx.txType)
      if (!existing) return

      const priceGwei = weiToGwei(tx.effectiveGasPrice)
      const feeEth = weiToEth(tx.fee)
      const gasUsed = Number(tx.gasUsed)

      const totalCount = existing.totalTxCount + 1
      const newAvgGasUsed = (existing.avgGasUsed * existing.totalTxCount + gasUsed) / totalCount
      const newAvgGasPrice = (existing.avgGasPrice * existing.totalTxCount + priceGwei) / totalCount

      newMetrics.set(tx.txType, {
        ...existing,
        avgGasUsed: newAvgGasUsed,
        avgGasPrice: newAvgGasPrice,
        minGasPrice: Math.min(existing.minGasPrice, priceGwei),
        maxGasPrice: Math.max(existing.maxGasPrice, priceGwei),
        totalTxCount: totalCount,
        recentTxCount: existing.recentTxCount + 1,
        totalFeeEth: existing.totalFeeEth + feeEth,
        trend: priceGwei > existing.avgGasPrice ? 'up' : priceGwei < existing.avgGasPrice ? 'down' : 'stable',
      })
    })

    const updatedTxs = [...txs, ...recentTxs].slice(0, MAX_RECENT_TXS)

    const totalGas = txs.reduce((sum, tx) => sum + Number(tx.gasUsed), 0)
    const avgBlockGas = txs.length > 0 ? totalGas / txs.length : 0

    set({
      gasMetrics: newMetrics,
      recentTxs: updatedTxs,
      networkStats: {
        currentGasPrice: txs.length > 0 ? weiToGwei(txs[0].effectiveGasPrice) : get().networkStats.currentGasPrice,
        avgBlockGas,
        tps: txs.length,
        totalTransactions: get().networkStats.totalTransactions + txs.length,
        lastBlockNumber: blockNumber,
      },
    })
  },

  selectType: (type) => set({ selectedType: type }),
  hoverType: (type) => set({ hoveredType: type }),
  setTimeRange: (range) => set({ timeRange: range }),
  setCollecting: (collecting) => set({ isCollecting: collecting }),
  setError: (error) => set({ error }),
  clearRecentTxs: () => set({ recentTxs: [] }),
}))
