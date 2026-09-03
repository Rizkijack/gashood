/**
 * Test Zustand store (BUILD_STEPS.md Langkah 9).
 *
 * Isolasi: gas-store punya state module-scope `priceAccumulator` (akumulator
 * harga non-nol per tipe) yang TIDAK bisa direset via setState. Maka tiap
 * test memakai `vi.resetModules()` + dynamic import untuk mendapat modul
 * segar, lalu state di-reset eksplisit via `useGasStore.setState(...)`
 * dengan state awal yang disalin dari definisi store (mandat AC).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TxType, type ClassifiedTransaction } from '@/data/tx-classifier'
import type { GasMetric } from '@/store/gas-store'

type StoreModule = typeof import('@/store/gas-store')

let useGasStore: StoreModule['useGasStore']

/** Mirror createInitialMetrics() di src/store/gas-store.ts. */
function makeInitialMetrics(): Map<TxType, GasMetric> {
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

/** State awal — disalin dari definisi store (src/store/gas-store.ts). */
function makeInitialState() {
  return {
    gasMetrics: makeInitialMetrics(),
    recentTxs: [] as ClassifiedTransaction[],
    networkStats: {
      currentGasPrice: 0,
      avgBlockGas: 0,
      tps: 0,
      totalTransactions: 0,
      lastBlockNumber: 0,
      ethUsdPrice: null,
    },
    blockscoutGasPrice: null as number | null,
    selectedType: null as TxType | null,
    hoveredType: null as TxType | null,
    timeRange: '5m' as const,
    isCollecting: false,
    error: null as string | null,
  }
}

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('@/store/gas-store')
  useGasStore = mod.useGasStore
  useGasStore.setState(makeInitialState())
})

let seq = 0
function makeTx(txType: TxType, overrides: Partial<ClassifiedTransaction> = {}): ClassifiedTransaction {
  seq += 1
  return {
    hash: `0x${seq.toString(16).padStart(64, '0')}`,
    from: `0x${'bb'.repeat(20)}`,
    to: `0x${'cc'.repeat(20)}`,
    input: '0x',
    value: 0n,
    gas: 21_000n,
    txType,
    gasUsed: 21_000n,
    effectiveGasPrice: 1_000_000_000n, // 1 gwei
    fee: 21_000n * 1_000_000_000n,
    ...overrides,
  }
}

describe('updateFromBlock / updateMetrics (Langkah 9)', () => {
  it('alias updateFromBlock mengubah gasMetrics + networkStats', () => {
    const tx = makeTx(TxType.NATIVE_TRANSFER, {
      gasUsed: 30_000n,
      effectiveGasPrice: 2_000_000_000n, // 2 gwei
      fee: 30_000n * 2_000_000_000n,
    })

    useGasStore.getState().updateFromBlock([tx], 42, 5_000_000_000n)

    const { gasMetrics, networkStats } = useGasStore.getState()
    const metric = gasMetrics.get(TxType.NATIVE_TRANSFER)!
    expect(metric.totalTxCount).toBe(1)
    expect(metric.avgGasUsed).toBe(30_000)
    expect(metric.avgGasPrice).toBe(2)
    // 30_000 × 2 gwei = 60_000 gwei-wei... = 6e13 wei = 6e-5 ETH
    expect(metric.totalFeeEth).toBeCloseTo(6e-5, 12)

    expect(networkStats.lastBlockNumber).toBe(42)
    expect(networkStats.totalTransactions).toBe(1)
    expect(networkStats.avgBlockGas).toBe(30_000)
    // currentGasPrice dari arg wei getGasPrice (5 gwei), bukan dari tx
    expect(networkStats.currentGasPrice).toBe(5)

    // Panggilan kedua dengan gas price 0n → currentGasPrice dipertahankan
    useGasStore.getState().updateFromBlock([tx], 43, 0n)
    expect(useGasStore.getState().networkStats.currentGasPrice).toBe(5)
  })

  it('recentTxCount = jumlah tx per tipe di batch TERBARU (perbaikan B1)', () => {
    const batch1 = [
      makeTx(TxType.NATIVE_TRANSFER),
      makeTx(TxType.NATIVE_TRANSFER),
      makeTx(TxType.DEX_SWAP),
    ]
    useGasStore.getState().updateFromBlock(batch1, 10)

    useGasStore.getState().updateFromBlock([makeTx(TxType.NATIVE_TRANSFER)], 11)

    const native = useGasStore.getState().gasMetrics.get(TxType.NATIVE_TRANSFER)!
    expect(native.totalTxCount).toBe(3) // akumulasi lintas batch
    expect(native.recentTxCount).toBe(1) // hanya 1 di batch terbaru

    const dex = useGasStore.getState().gasMetrics.get(TxType.DEX_SWAP)!
    expect(dex.totalTxCount).toBe(1)
    expect(dex.recentTxCount).toBe(1)
  })

  it('effectiveGasPrice 0n di-skip — tidak meracuni min/avg/maxGasPrice (perbaikan B1)', () => {
    const priced = makeTx(TxType.NATIVE_TRANSFER, { effectiveGasPrice: 1_000_000_000n })
    const unpriced = makeTx(TxType.NATIVE_TRANSFER, { effectiveGasPrice: 0n, fee: 0n })

    useGasStore.getState().updateFromBlock([priced, unpriced], 1)

    const metric = useGasStore.getState().gasMetrics.get(TxType.NATIVE_TRANSFER)!
    expect(metric.totalTxCount).toBe(2) // tx tetap dihitung
    expect(metric.avgGasPrice).toBe(1) // hanya dari 1 tx berharga
    expect(metric.minGasPrice).toBe(1)
    expect(metric.maxGasPrice).toBe(1)
  })

  it('batch tanpa harga (semua 0n) → harga tetap netral', () => {
    const tx = makeTx(TxType.ERC20_TRANSFER, { effectiveGasPrice: 0n, fee: 0n })
    useGasStore.getState().updateFromBlock([tx], 1)

    const metric = useGasStore.getState().gasMetrics.get(TxType.ERC20_TRANSFER)!
    expect(metric.totalTxCount).toBe(1)
    expect(metric.avgGasPrice).toBe(0)
    expect(metric.minGasPrice).toBe(Infinity)
    expect(metric.maxGasPrice).toBe(0)
  })

  it('tps = jumlah tx / blockTime detik (perbaikan B9) — blockTime 100 ms → 0.1 s', () => {
    const txs = Array.from({ length: 5 }, () => makeTx(TxType.NATIVE_TRANSFER))
    useGasStore.getState().updateFromBlock(txs, 1)

    // 5 tx / 0.1 s = 50 tx/s (bukan 5 "per block")
    expect(useGasStore.getState().networkStats.tps).toBeCloseTo(50)
  })
})

describe('recentTxs ring buffer (Langkah 9)', () => {
  it('maksimal 200 — isi 250 → panjang 200', () => {
    const txs = Array.from({ length: 250 }, () => makeTx(TxType.NATIVE_TRANSFER))
    useGasStore.getState().updateFromBlock(txs, 1)

    // Perilaku aktual: slice(0, 200) — dalam satu batch raksasa urutan array
    // dipertahankan dan kelebihan dipotong dari ekor.
    expect(useGasStore.getState().recentTxs).toHaveLength(200)
  })

  it('FIFO lintas batch — batch baru di depan, tx lama terdorong/terpotong', () => {
    const oldTxs = Array.from({ length: 150 }, () => makeTx(TxType.NATIVE_TRANSFER))
    useGasStore.setState({ recentTxs: oldTxs })

    const newTxs = Array.from({ length: 100 }, () => makeTx(TxType.ERC20_TRANSFER))
    useGasStore.getState().updateFromBlock(newTxs, 2)

    const recent = useGasStore.getState().recentTxs
    expect(recent).toHaveLength(200)
    expect(recent[0]!.hash).toBe(newTxs[0]!.hash) // terbaru di depan
    expect(recent[99]!.hash).toBe(newTxs[99]!.hash)
    expect(recent[100]!.hash).toBe(oldTxs[0]!.hash) // lama menyusul di belakang
  })
})

describe('setEthUsdPrice (harga ETH USD)', () => {
  it('mengubah networkStats.ethUsdPrice tanpa mengubah field lain', () => {
    useGasStore.getState().setEthUsdPrice(3214.56)

    const stats = useGasStore.getState().networkStats
    expect(stats.ethUsdPrice).toBe(3214.56)
    expect(stats.lastBlockNumber).toBe(0)
    expect(stats.currentGasPrice).toBe(0)
  })

  it('null aman — kembali ke default (UI sembunyikan bagian USD)', () => {
    useGasStore.getState().setEthUsdPrice(100)
    useGasStore.getState().setEthUsdPrice(null)

    expect(useGasStore.getState().networkStats.ethUsdPrice).toBeNull()
  })

  it('updateFromBlock mempertahankan ethUsdPrice yang sudah diset (tidak flicker ke null)', () => {
    useGasStore.getState().setEthUsdPrice(3000)
    useGasStore.getState().updateFromBlock([makeTx(TxType.NATIVE_TRANSFER)], 5)

    expect(useGasStore.getState().networkStats.ethUsdPrice).toBe(3000)
  })
})

describe('setBlockscoutGasPrice + preferensi Blockscout-over-RPC (sumber utama gas price)', () => {
  it('setBlockscoutGasPrice mengubah blockscoutGasPrice tanpa menyentuh networkStats', () => {
    useGasStore.getState().setBlockscoutGasPrice(0.48)

    const state = useGasStore.getState()
    expect(state.blockscoutGasPrice).toBe(0.48)
    // currentGasPrice hanya berubah lewat updateMetrics — action ini sekadar
    // mengisi sumber utama dari Blockscout gas tracker (throttle 60s).
    expect(state.networkStats.currentGasPrice).toBe(0)
    expect(state.networkStats.lastBlockNumber).toBe(0)
  })

  it('updateMetrics: blockscoutGasPrice non-null → MENANGKAN eth_gasPrice RPC (Blockscout = sumber utama)', () => {
    useGasStore.getState().setBlockscoutGasPrice(0.48)

    // RPC memberi 5 gwei, tapi tampilan harus pakai gas tracker (0.48)
    useGasStore.getState().updateFromBlock([makeTx(TxType.NATIVE_TRANSFER)], 42, 5_000_000_000n)

    expect(useGasStore.getState().networkStats.currentGasPrice).toBe(0.48)
  })

  it('updateMetrics: blockscoutGasPrice null (poll Blockscout belum sukses) → fallback eth_gasPrice RPC', () => {
    useGasStore.getState().updateFromBlock([makeTx(TxType.NATIVE_TRANSFER)], 42, 5_000_000_000n)

    expect(useGasStore.getState().networkStats.currentGasPrice).toBe(5)
  })

  it('updateMetrics: RPC 0n + blockscoutGasPrice null → pertahankan nilai sebelumnya (fallback lama tetap)', () => {
    useGasStore.getState().updateFromBlock([makeTx(TxType.NATIVE_TRANSFER)], 42, 5_000_000_000n)
    useGasStore.getState().updateFromBlock([makeTx(TxType.NATIVE_TRANSFER)], 43, 0n)

    expect(useGasStore.getState().networkStats.currentGasPrice).toBe(5)
  })

  it('updateMetrics tidak mengubah blockscoutGasPrice (hanya collector yang menulisnya)', () => {
    useGasStore.getState().setBlockscoutGasPrice(0.48)
    useGasStore.getState().updateFromBlock([makeTx(TxType.NATIVE_TRANSFER)], 42, 5_000_000_000n)

    expect(useGasStore.getState().blockscoutGasPrice).toBe(0.48)
  })
})

describe('seleksi UI (Langkah 9)', () => {
  it('selectType / hoverType / clearSelection', () => {
    useGasStore.getState().selectType(TxType.DEX_SWAP)
    useGasStore.getState().hoverType(TxType.NATIVE_TRANSFER)

    expect(useGasStore.getState().selectedType).toBe(TxType.DEX_SWAP)
    expect(useGasStore.getState().hoveredType).toBe(TxType.NATIVE_TRANSFER)

    useGasStore.getState().clearSelection()
    expect(useGasStore.getState().selectedType).toBeNull()
    expect(useGasStore.getState().hoveredType).toBe(TxType.NATIVE_TRANSFER) // hover tidak ikut terhapus

    useGasStore.getState().hoverType(null)
    expect(useGasStore.getState().hoveredType).toBeNull()
  })
})
