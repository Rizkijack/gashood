/**
 * Test RPC client (BUILD_STEPS.md Langkah 5-6).
 * viem DIMOCK penuh via vi.mock — tidak ada network call asli sama sekali.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchGetReceipts,
  getBlock,
  getGasPrice,
  getLatestBlock,
  getLatestBlockNumber,
  getRpcClient,
  getTransactionReceipt,
} from '@/data/rpc-client'

const viem = vi.hoisted(() => {
  const client = {
    getBlock: vi.fn(),
    getBlockNumber: vi.fn(),
    getTransactionReceipt: vi.fn(),
    getGasPrice: vi.fn(),
  }
  return {
    client,
    createPublicClient: vi.fn((_args: { chain: { id: number } }) => client),
    http: vi.fn(() => ({ mocked: true })),
  }
})

vi.mock('viem', () => ({
  http: viem.http,
  createPublicClient: viem.createPublicClient,
}))

const client = viem.client
const receipt = { gasUsed: 21_000n, effectiveGasPrice: 1_000_000_000n, status: 'success' }
const hash = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`

beforeEach(() => {
  client.getBlock.mockReset()
  client.getBlockNumber.mockReset()
  client.getTransactionReceipt.mockReset()
  client.getGasPrice.mockReset()
})

describe('getRpcClient (Langkah 5)', () => {
  it('membuat client untuk chain 4663 dengan transport mocked (tanpa network asli)', () => {
    getRpcClient()
    expect(viem.createPublicClient).toHaveBeenCalledTimes(1)
    const arg = viem.createPublicClient.mock.calls[0][0] as { chain: { id: number } }
    expect(arg.chain.id).toBe(4663)
    // Transport dibuat lewat http() yang dimock — bukan stack network asli
    expect(viem.http).toHaveBeenCalled()
  })
})

describe('getBlock / getLatestBlock / getLatestBlockNumber (Langkah 5)', () => {
  it('getBlock(number) delegasi ke client.getBlock dengan includeTransactions', async () => {
    const fakeBlock = { number: 5n, transactions: [] }
    client.getBlock.mockResolvedValue(fakeBlock)

    const result = await getBlock(5n)

    expect(result).toBe(fakeBlock)
    expect(client.getBlock).toHaveBeenCalledWith({ blockNumber: 5n, includeTransactions: true })
  })

  it("getBlock('latest') via getLatestBlock → blockNumber undefined", async () => {
    const fakeBlock = { number: 9n, transactions: [] }
    client.getBlock.mockResolvedValue(fakeBlock)

    const result = await getLatestBlock()

    expect(result).toBe(fakeBlock)
    expect(client.getBlock).toHaveBeenCalledWith({
      blockNumber: undefined,
      includeTransactions: true,
    })
  })

  it('getLatestBlockNumber delegasi ke client.getBlockNumber', async () => {
    client.getBlockNumber.mockResolvedValue(123n)
    await expect(getLatestBlockNumber()).resolves.toBe(123n)
  })

  it('getGasPrice delegasi ke client.getGasPrice', async () => {
    client.getGasPrice.mockResolvedValue(7n)
    await expect(getGasPrice()).resolves.toBe(7n)
  })
})

describe('getTransactionReceipt (Langkah 6)', () => {
  it('sukses → receipt berisi gasUsed & effectiveGasPrice', async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt)

    const result = await getTransactionReceipt(hash(1))

    expect(result).toBe(receipt)
    expect(result!.gasUsed).toBe(21_000n)
    expect(result!.effectiveGasPrice).toBe(1_000_000_000n)
  })

  it('error RPC → null tanpa throw', async () => {
    client.getTransactionReceipt.mockRejectedValue(new Error('rpc down'))

    await expect(getTransactionReceipt(hash(1))).resolves.toBeNull()
  })
})

describe('batchGetReceipts (Langkah 6)', () => {
  it('20 hash → 20 receipt kembali', async () => {
    client.getTransactionReceipt.mockResolvedValue(receipt)

    const hashes = Array.from({ length: 20 }, (_, i) => hash(i))
    const receipts = await batchGetReceipts(hashes)

    expect(receipts.size).toBe(20)
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(20)
  })

  it('45 hash → di-chunk, maksimal 20 request paralel per batch', async () => {
    let inFlight = 0
    let maxInFlight = 0
    client.getTransactionReceipt.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return receipt
    })

    const hashes = Array.from({ length: 45 }, (_, i) => hash(i))
    const receipts = await batchGetReceipts(hashes)

    expect(receipts.size).toBe(45)
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(45)
    // Tanpa chunking, maxInFlight akan mencapai 45
    expect(maxInFlight).toBeLessThanOrEqual(20)
  })

  it('receipt gagal → di-skip graceful, batch tetap resolve tanpa throw', async () => {
    const failing = hash(1)
    // viem client.getTransactionReceipt menerima argumen objek { hash }
    client.getTransactionReceipt.mockImplementation(async (args: { hash: `0x${string}` }) => {
      if (args.hash === failing) throw new Error('receipt not found')
      return receipt
    })

    const receipts = await batchGetReceipts([hash(0), failing, hash(2)])

    expect(receipts.size).toBe(2)
    expect(receipts.has(failing)).toBe(false)
    expect(receipts.get(hash(0))).toBe(receipt)
    expect(receipts.get(hash(2))).toBe(receipt)
  })

  it('semua receipt gagal → map kosong, tidak throw', async () => {
    client.getTransactionReceipt.mockRejectedValue(new Error('boom'))

    const receipts = await batchGetReceipts([hash(1), hash(2)])

    expect(receipts.size).toBe(0)
  })
})
