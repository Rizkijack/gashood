/**
 * Test gas collector (BUILD_STEPS.md Langkah 8).
 * '@/data/rpc-client' di-mock penuh — processBlock & aggregateMetrics diuji
 * murni tanpa network. Loop polling (startCollecting) SENGAJA tidak pernah
 * dinyalakan (while(true)); state module-scope collector (currentInterval,
 * isRunning) tidak perlu direset karena tidak ada test yang memulai loop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aggregateMetrics, processBlock, stopCollecting } from '@/data/gas-collector'
import { TxType, type ClassifiedTransaction, type TransactionData } from '@/data/tx-classifier'
import { useGasStore } from '@/store/gas-store'

const rpc = vi.hoisted(() => ({
  getBlock: vi.fn(),
  getGasPrice: vi.fn(),
  getLatestBlockNumber: vi.fn(),
  batchGetReceipts: vi.fn(),
}))

vi.mock('@/data/rpc-client', () => rpc)

beforeEach(() => {
  rpc.getBlock.mockReset()
  rpc.getGasPrice.mockReset()
  rpc.getLatestBlockNumber.mockReset()
  rpc.batchGetReceipts.mockReset()
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
      makeClassified(TxType.DEX_SWAP, { gasUsed: 400n, effectiveGasPrice: gwei(10n), fee: 400n * gwei(10n) }),
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

    const dex = metrics.get(TxType.DEX_SWAP)!
    expect(dex.totalTxCount).toBe(1)
    expect(dex.avgGasUsed).toBe(400)
    expect(dex.avgGasPrice).toBe(10)

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
      makeClassified(TxType.DEX_SWAP, { effectiveGasPrice: 0n, fee: 0n }),
    ]

    const metrics = aggregateMetrics(txs)

    const erc20 = metrics.get(TxType.ERC20_TRANSFER)!
    expect(erc20.totalTxCount).toBe(2)
    expect(erc20.avgGasPrice).toBe(2)
    expect(erc20.minGasPrice).toBe(2)
    expect(erc20.maxGasPrice).toBe(2)

    const dex = metrics.get(TxType.DEX_SWAP)!
    expect(dex.totalTxCount).toBe(1)
    expect(dex.avgGasPrice).toBe(0)
    expect(dex.minGasPrice).toBe(Infinity)
    expect(dex.maxGasPrice).toBe(0)
  })

  it('input kosong (0 tx) → tidak crash; hasil skeleton 12 tipe dengan metrik nol', () => {
    // Catatan drift dokumen: BUILD_STEPS.md bilang "map kosong" — aktualnya
    // aggregateMetrics mengembalikan skeleton untuk SEMUA 12 TxType bernilai nol.
    const metrics = aggregateMetrics([])

    expect(metrics.size).toBe(12)
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
