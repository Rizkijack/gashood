import { getBlock, getGasPrice, getLatestBlockNumber, batchGetReceipts } from '@/data/rpc-client'
import { classifyTransaction, TxType, type ClassifiedTransaction, type TransactionData } from '@/data/tx-classifier'
import { useGasStore, type GasMetric } from '@/store/gas-store'
import { calculateTotalFee, weiToGwei, weiToEth } from '@/utils/gas-math'
import type { Block } from 'viem'

/** Clamp VITE_POLLING_INTERVAL: NaN/negatif/0 → 3000, lalu min 1000, max 10000. */
function parsePollingInterval(raw: string | undefined): number {
  const parsed = parseInt(raw ?? '')
  if (Number.isNaN(parsed) || parsed <= 0) return 3000
  return Math.min(Math.max(parsed, 1000), 10_000)
}

const BASE_INTERVAL = parsePollingInterval(import.meta.env.VITE_POLLING_INTERVAL)
const MAX_INTERVAL = 10_000

let currentInterval = BASE_INTERVAL
let lastBlockNumber = 0n
let isRunning = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function adaptInterval(success: boolean) {
  if (success) {
    currentInterval = Math.max(currentInterval - 500, BASE_INTERVAL)
  } else {
    currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL)
  }
}

function toTransactionData(tx: Block<bigint, true>['transactions'][number]): TransactionData {
  return {
    hash: tx.hash,
    from: tx.from,
    to: tx.to ?? null,
    input: tx.input,
    value: tx.value,
    gas: tx.gas,
    gasPrice: 'gasPrice' in tx ? tx.gasPrice : undefined,
    type: tx.type,
  }
}

/**
 * Ambil + klasifikasi semua tx dalam satu block (Langkah 5-8).
 * PURE terhadap store: menerima nomor block, mengembalikan ClassifiedTx[]
 * tanpa menulis ke gas-store.
 */
export async function processBlock(blockNumber: bigint | 'latest'): Promise<ClassifiedTransaction[]> {
  const block = await getBlock(blockNumber)
  const transactions = block.transactions

  if (transactions.length === 0) {
    return []
  }

  const txDataList = transactions.map(toTransactionData)
  const hashes = txDataList.map((tx) => tx.hash as `0x${string}`)
  const receipts = await batchGetReceipts(hashes)

  const classifiedTxs: ClassifiedTransaction[] = []

  for (const txData of txDataList) {
    const receipt = receipts.get(txData.hash)
    const txType = classifyTransaction(txData)

    const gasUsed = receipt?.gasUsed ?? txData.gas
    const effectiveGasPrice = receipt?.effectiveGasPrice ?? txData.gasPrice ?? 0n
    const fee = calculateTotalFee(gasUsed, effectiveGasPrice)

    classifiedTxs.push({
      ...txData,
      txType,
      gasUsed,
      effectiveGasPrice,
      fee,
    })
  }

  return classifiedTxs
}

/**
 * Agregasi murni per TxType dari satu batch tx (Langkah 8).
 * Tidak menyentuh store. Tx dengan effectiveGasPrice 0n (receipt hilang)
 * tidak boleh meracuni min/avg harga. Trend butuh konteks window
 * sebelumnya — dihitung oleh store saat merge, jadi di sini 'stable'.
 */
export function aggregateMetrics(txs: ClassifiedTransaction[]): Map<TxType, GasMetric> {
  interface Accumulator {
    count: number
    gasSum: number
    priceSum: number
    priceCount: number
    feeEthSum: number
    minPrice: number
    maxPrice: number
  }

  const acc = new Map<TxType, Accumulator>()

  for (const tx of txs) {
    let a = acc.get(tx.txType)
    if (!a) {
      a = { count: 0, gasSum: 0, priceSum: 0, priceCount: 0, feeEthSum: 0, minPrice: Infinity, maxPrice: 0 }
      acc.set(tx.txType, a)
    }
    a.count += 1
    a.gasSum += Number(tx.gasUsed)
    a.feeEthSum += weiToEth(tx.fee)

    if (tx.effectiveGasPrice > 0n) {
      const priceGwei = weiToGwei(tx.effectiveGasPrice)
      a.priceSum += priceGwei
      a.priceCount += 1
      a.minPrice = Math.min(a.minPrice, priceGwei)
      a.maxPrice = Math.max(a.maxPrice, priceGwei)
    }
  }

  const metrics = new Map<TxType, GasMetric>()
  for (const type of Object.values(TxType)) {
    const a = acc.get(type)
    metrics.set(type, {
      txType: type,
      avgGasUsed: a && a.count > 0 ? a.gasSum / a.count : 0,
      avgGasPrice: a && a.priceCount > 0 ? a.priceSum / a.priceCount : 0,
      minGasPrice: a ? a.minPrice : Infinity,
      maxGasPrice: a ? a.maxPrice : 0,
      totalTxCount: a ? a.count : 0,
      recentTxCount: a ? a.count : 0, // satu batch = window terakhir
      totalFeeEth: a ? a.feeEthSum : 0,
      trend: 'stable',
    })
  }

  return metrics
}

/** Satu siklus polling: dedup block → processBlock → push ke store via updateFromBlock. */
async function runCycle(): Promise<boolean> {
  try {
    const blockNumber = await getLatestBlockNumber()

    if (blockNumber === lastBlockNumber) {
      adaptInterval(true)
      return true
    }

    const [txs, gasPriceWei] = await Promise.all([processBlock(blockNumber), getGasPrice()])

    // Audit B6: stop() bisa dipanggil saat request in-flight —
    // jangan tulis ke store setelah stop.
    if (!isRunning) {
      return true
    }

    lastBlockNumber = blockNumber

    if (txs.length > 0) {
      useGasStore.getState().updateFromBlock(txs, Number(blockNumber), gasPriceWei)
    }

    adaptInterval(true)
    // Audit B5: baca ulang error SETELAH await (bukan snapshot lama).
    if (useGasStore.getState().error) {
      useGasStore.getState().setError(null)
    }

    return true
  } catch (error) {
    adaptInterval(false)
    useGasStore.getState().setError(error instanceof Error ? error.message : 'Unknown error')
    return false
  }
}

async function pollingLoop(): Promise<void> {
  while (isRunning) {
    await runCycle()
    if (!isRunning) break // audit B6
    await sleep(currentInterval)
  }
}

export function startCollecting(): void {
  if (isRunning) return

  isRunning = true
  lastBlockNumber = 0n
  useGasStore.getState().setCollecting(true)

  void pollingLoop()
}

export function stopCollecting(): void {
  isRunning = false
  useGasStore.getState().setCollecting(false)
}

export async function collectOnce(): Promise<boolean> {
  return runCycle()
}
