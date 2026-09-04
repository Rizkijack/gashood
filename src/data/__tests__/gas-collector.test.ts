/**
 * Test gas collector (BUILD_STEPS.md Langkah 8).
 * '@/data/rpc-client' dan '@/data/blockscout-client' di-mock penuh —
 * processBlock, aggregateMetrics, parseCoinPrice & refreshEthPriceIfDue diuji
 * murni tanpa network. Loop polling (startCollecting) SENGAJA tidak pernah
 * dinyalakan (while(true)); state module-scope collector (currentInterval,
 * isRunning) tidak perlu direset karena tidak ada test yang memulai loop.
 * Throttle harga (lastPriceFetchAt) dikendalikan lewat mock Date.now, bukan
 * vi.resetModules() + dynamic import — import statis dipertahankan agar test
 * memakai instance useGasStore yang sama dengan asersi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aggregateMetrics,
  parseCoinPrice,
  parseGasPriceFromStats,
  processBlock,
  refreshEthPriceIfDue,
  stopCollecting,
} from '@/data/gas-collector'
import { TxType, type ClassifiedTransaction, type TransactionData } from '@/data/tx-classifier'
import { useGasStore } from '@/store/gas-store'

const rpc = vi.hoisted(() => ({
  getBlock: vi.fn(),
  getGasPrice: vi.fn(),
  getLatestBlockNumber: vi.fn(),
  batchGetReceipts: vi.fn(),
}))

const blockscout = vi.hoisted(() => ({
  getStats: vi.fn(),
}))

vi.mock('@/data/rpc-client', () => rpc)
vi.mock('@/data/blockscout-client', () => blockscout)

beforeEach(() => {
  rpc.getBlock.mockReset()
  rpc.getGasPrice.mockReset()
  rpc.getLatestBlockNumber.mockReset()
  rpc.batchGetReceipts.mockReset()
  blockscout.getStats.mockReset()
})

let seq = 0
function makeBlockTx(overrides: Partial<TransactionData> = {}): TransactionData {
  seq += 1
  return {
    hash: `0x${seq.toString(16).padStart(64, '0')}`,
    from: `0x${'bb'.repeat(20)}`,
    to: `0x${'cc'.repeat(20)}`,
    input: '0x',
    value: 0n,
    gas: 21_000n,
    ...overrides,
  }
}

function makeClassified(
  txType: TxType,
  overrides: Partial<ClassifiedTransaction> = {}
): ClassifiedTransaction {
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

describe('processBlock (Langkah 8)', () => {
  it('mengembalikan ClassifiedTransaction[]: klasifikasi + receipt + fee, tanpa menyentuh store', async () => {
    const nativeTx = makeBlockTx({ input: '0x', gas: 21_000n, gasPrice: 1_000_000_000n })
    const erc20Tx = makeBlockTx({ input: `0xa9059cbb${'11'.repeat(32)}`, gas: 50_000n }) // tanpa gasPrice
    rpc.getBlock.mockResolvedValue({ number: 5n, transactions: [nativeTx, erc20Tx] })
    rpc.batchGetReceipts.mockResolvedValue(
      new Map([[erc20Tx.hash, { gasUsed: 60_000n, effectiveGasPrice: 2_000_000_000n }]])
    )

    const result = await processBlock(5n)

    expect(rpc.getBlock).toHaveBeenCalledWith(5n)
    expect(rpc.batchGetReceipts).toHaveBeenCalledWith([nativeTx.hash, erc20Tx.hash])

    expect(result).toHaveLength(2)
    // Receipt hilang → fallback ke tx.gas dan tx.gasPrice
    expect(result[0]).toMatchObject({
      hash: nativeTx.hash,
      txType: TxType.NATIVE_TRANSFER,
      gasUsed: 21_000n,
      effectiveGasPrice: 1_000_000_000n,
      fee: 21_000n * 1_000_000_000n,
    })
    // Receipt ada → gasUsed & effectiveGasPrice dari receipt
    expect(result[1]).toMatchObject({
      hash: erc20Tx.hash,
      txType: TxType.ERC20_TRANSFER,
      gasUsed: 60_000n,
      effectiveGasPrice: 2_000_000_000n,
      fee: 60_000n * 2_000_000_000n,
    })

    // PURE terhadap store — tidak ada efek samping
    const state = useGasStore.getState()
    expect(state.recentTxs).toHaveLength(0)
    expect(state.gasMetrics.get(TxType.NATIVE_TRANSFER)!.totalTxCount).toBe(0)
  })

  it("delegasi 'latest' ke getBlock", async () => {
    rpc.getBlock.mockResolvedValue({ transactions: [] })

    await processBlock('latest')

    expect(rpc.getBlock).toHaveBeenCalledWith('latest')
  })

  it('block kosong (0 tx) → [] tanpa fetch receipt, tidak crash', async () => {
    rpc.getBlock.mockResolvedValue({ number: 7n, transactions: [] })

    const result = await processBlock(7n)

    expect(result).toEqual([])
    expect(rpc.batchGetReceipts).not.toHaveBeenCalled()
  })
})

describe('aggregateMetrics (Langkah 8)', () => {
  const gwei = (n: bigint) => n * 1_000_000_000n

  it('menghitung avg/min/max/count/fee per tipe dengan benar', () => {
    const txs = [
      makeClassified(TxType.ERC20_TRANSFER, { gasUsed: 100n, effectiveGasPrice: gwei(1n), fee: 100n * gwei(1n) }),
      makeClassified(TxType.ERC20_TRANSFER, { gasUsed: 200n, effectiveGasPrice: gwei(2n), fee: 200n * gwei(2n) }),
      makeClassified(TxType.ERC20_TRANSFER, { gasUsed: 300n, effectiveGasPrice: gwei(3n), fee: 300n * gwei(3n) }),
      // refactor 12→4: eks DEX_SWAP → SWAP
      makeClassified(TxType.SWAP, { gasUsed: 400n, effectiveGasPrice: gwei(10n), fee: 400n * gwei(10n) }),
    ]

    const metrics = aggregateMetrics(txs)

    const erc20 = metrics.get(TxType.ERC20_TRANSFER)!
    expect(erc20.totalTxCount).toBe(3)
    expect(erc20.avgGasUsed).toBe(200)
    expect(erc20.avgGasPrice).toBe(2)
    expect(erc20.minGasPrice).toBe(1)
    expect(erc20.maxGasPrice).toBe(3)
    expect(erc20.recentTxCount).toBe(3) // satu batch = window terakhir
    // total fee = (100·1 + 200·2 + 300·3) gwei = 1.4e12 wei = 1.4e-6 ETH
    expect(erc20.totalFeeEth).toBeCloseTo(1.4e-6, 12)

    const swap = metrics.get(TxType.SWAP)!
    expect(swap.totalTxCount).toBe(1)
    expect(swap.avgGasUsed).toBe(400)
    expect(swap.avgGasPrice).toBe(10)

    // Tipe tanpa tx → skeleton nol, trend default 'stable'
    const native = metrics.get(TxType.NATIVE_TRANSFER)!
    expect(native.totalTxCount).toBe(0)
    expect(native.avgGasPrice).toBe(0)
    expect(native.minGasPrice).toBe(Infinity)
    expect(native.trend).toBe('stable')
  })

  it('harga 0n (receipt hilang) di-skip — tidak meracuni min/avg/max harga', () => {
    const txs = [
      makeClassified(TxType.ERC20_TRANSFER, { effectiveGasPrice: gwei(2n), fee: 21_000n * gwei(2n) }),
      makeClassified(TxType.ERC20_TRANSFER, { effectiveGasPrice: 0n, fee: 0n }),
      // refactor 12→4: eks DEX_SWAP → SWAP
      makeClassified(TxType.SWAP, { effectiveGasPrice: 0n, fee: 0n }),
    ]

    const metrics = aggregateMetrics(txs)

    const erc20 = metrics.get(TxType.ERC20_TRANSFER)!
    expect(erc20.totalTxCount).toBe(2)
    expect(erc20.avgGasPrice).toBe(2)
    expect(erc20.minGasPrice).toBe(2)
    expect(erc20.maxGasPrice).toBe(2)

    const swap = metrics.get(TxType.SWAP)!
    expect(swap.totalTxCount).toBe(1)
    expect(swap.avgGasPrice).toBe(0)
    expect(swap.minGasPrice).toBe(Infinity)
    expect(swap.maxGasPrice).toBe(0)
  })

  it('input kosong (0 tx) → tidak crash; hasil skeleton 4 kategori dengan metrik nol (refactor 12→4)', () => {
    // Refactor 12 → 4 kategori: skeleton kini untuk SEMUA 4 TxType bernilai nol.
    const metrics = aggregateMetrics([])

    expect(metrics.size).toBe(4)
    for (const metric of metrics.values()) {
      expect(metric.totalTxCount).toBe(0)
      expect(metric.avgGasUsed).toBe(0)
      expect(metric.avgGasPrice).toBe(0)
    }
  })
})

describe('state module-scope collector (currentInterval / isRunning)', () => {
  it('stopCollecting tanpa start → aman, isCollecting false (loop tidak dinyalakan di test)', () => {
    expect(() => stopCollecting()).not.toThrow()
    expect(useGasStore.getState().isCollecting).toBe(false)
  })
})

describe('parseCoinPrice (harga ETH dari Blockscout /stats)', () => {
  it('happy: string desimal → number', () => {
    expect(parseCoinPrice('3214.56')).toBe(3214.56)
    expect(parseCoinPrice('4200')).toBe(4200)
  })

  it('edge: non-numerik → null', () => {
    expect(parseCoinPrice('abc')).toBeNull()
    expect(parseCoinPrice('')).toBeNull()
  })

  it('edge: NaN/Infinity hasil parse → null', () => {
    expect(parseCoinPrice('NaN')).toBeNull()
    expect(parseCoinPrice('Infinity')).toBeNull()
  })

  it('guard: harga <= 0 → null ("0"/negatif tidak boleh meracuni tampilan USD)', () => {
    expect(parseCoinPrice('0')).toBeNull()
    expect(parseCoinPrice('-5')).toBeNull()
    // Nilai valid tetap lolos
    expect(parseCoinPrice('2393.83')).toBe(2393.83)
    expect(parseCoinPrice('abc')).toBeNull()
  })
})

describe('parseGasPriceFromStats (gas real-time Blockscout gas tracker)', () => {
  it('happy: average valid → number (Gwei)', () => {
    expect(parseGasPriceFromStats({ slow: 0.01, average: 0.48, fast: 1.2 })).toBe(0.48)
    expect(parseGasPriceFromStats({ slow: 0.02, average: 5, fast: 10 })).toBe(5)
  })

  it('edge: average 0 / negatif / NaN → null (nilai rusak tidak boleh jadi sumber utama currentGasPrice)', () => {
    expect(parseGasPriceFromStats({ slow: 0, average: 0, fast: 0 })).toBeNull()
    expect(parseGasPriceFromStats({ slow: 0.01, average: -1, fast: 1.2 })).toBeNull()
    expect(parseGasPriceFromStats({ slow: 0.01, average: NaN, fast: 1.2 })).toBeNull()
  })

  it('edge: gas_prices undefined / average undefined → null (fallback ke eth_gasPrice RPC)', () => {
    expect(parseGasPriceFromStats(undefined)).toBeNull()
    expect(parseGasPriceFromStats({ slow: 0, average: undefined as unknown as number, fast: 1 })).toBeNull()
  })
})

describe('refreshEthPriceIfDue (harga ETH Blockscout — throttle 60s, non-fatal)', () => {
  let nowMs: number

  beforeEach(() => {
    nowMs = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    // Isolasi store (instance sama lintas test di file ini): reset tulisan
    // test lain sebelum asersi.
    useGasStore.setState({ blockscoutGasPrice: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('NON-FATAL: getStats reject → consecutiveFailures 0, error null, metrik block tak tersentuh', async () => {
    blockscout.getStats.mockRejectedValue(new Error('Blockscout down'))
    const metricsBefore = useGasStore.getState().gasMetrics
    const txsBefore = useGasStore.getState().recentTxs

    await expect(refreshEthPriceIfDue(0)).resolves.toBeUndefined()

    const state = useGasStore.getState()
    expect(state.consecutiveFailures).toBe(0)
    expect(state.error).toBeNull()
    // Referensi sama → metrik block & feed tidak pernah di-replace oleh jalur harga
    expect(state.gasMetrics).toBe(metricsBefore)
    expect(state.recentTxs).toBe(txsBefore)
    expect(state.networkStats.ethUsdPrice).toBeNull()
  })

  it('THROTTLE: 2 panggilan jeda <60s → getStats hanya 1×; setelah 60s fetch lagi', async () => {
    blockscout.getStats.mockResolvedValue({ coin_price: '2393.83' })

    nowMs = 5_000_000 // jauh dari timestamp test NON-FATAL (1e6) → throttle terlewati
    await refreshEthPriceIfDue(0)

    nowMs += 59_999 // jeda < PRICE_FETCH_INTERVAL_MS (60s)
    await refreshEthPriceIfDue(0)
    expect(blockscout.getStats).toHaveBeenCalledTimes(1)

    nowMs += 60_000 // window 60s terlewati → boleh menembak lagi
    await refreshEthPriceIfDue(0)
    expect(blockscout.getStats).toHaveBeenCalledTimes(2)
  })

  // Catatan: jalur WRITE (setEthUsdPrice / setBlockscoutGasPrice) tidak bisa
  // diuji di file ini karena guard B6 mem-block saat isRunning=false (loop
  // sengaja tidak pernah dinyalakan — lihat header file). Perilaku store
  // setBlockscoutGasPrice + preferensi Blockscout-over-RPC diuji di
  // src/store/__tests__/gas-store.test.ts.

  it('guard B6: generation stale (myRun !== runId) → coin_price & gas_prices sama-sama TIDAK ditulis', async () => {
    blockscout.getStats.mockResolvedValue({
      coin_price: '2393.83',
      gas_prices: { slow: 0.01, average: 0.48, fast: 1.2 },
    })

    nowMs = 11_000_000
    await refreshEthPriceIfDue(999_999) // runId masih 0 (loop tak pernah start)

    const state = useGasStore.getState()
    expect(state.blockscoutGasPrice).toBeNull()
    expect(state.networkStats.ethUsdPrice).toBeNull()
  })
})
