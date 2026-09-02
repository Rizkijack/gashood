import { getLatestBlock, batchGetReceipts } from '@/data/rpc-client'
import { classifyTransaction, type ClassifiedTransaction, type TransactionData } from '@/data/tx-classifier'
import { useGasStore } from '@/store/gas-store'
import { calculateTotalFee } from '@/utils/gas-math'

const BASE_INTERVAL = parseInt(import.meta.env.VITE_POLLING_INTERVAL || '3000')
const MAX_INTERVAL = 10_000

let currentInterval = BASE_INTERVAL
let pollingTimer: ReturnType<typeof setTimeout> | null = null
let lastBlockNumber = 0
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

async function processBlock(): Promise<boolean> {
  const store = useGasStore.getState()

  try {
    const block = await getLatestBlock()
    const blockNumber = Number(block.number)

    if (blockNumber === lastBlockNumber) {
      return true
    }

    lastBlockNumber = blockNumber
    const transactions = block.transactions

    if (transactions.length === 0) {
      return true
    }

    const txDataList: TransactionData[] = transactions.map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to ?? null,
      input: tx.input,
      value: tx.value,
      gas: tx.gas,
      gasPrice: 'gasPrice' in tx ? tx.gasPrice : undefined,
      type: tx.type,
    }))

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

    store.updateMetrics(classifiedTxs, blockNumber)
    // Bersihkan error banner setelah cycle sukses (recovery dari RPC hiccup)
    if (store.error) store.setError(null)
    adaptInterval(true)

    return true
  } catch (error) {
    console.error('GasCollector error:', error)
    adaptInterval(false)
    store.setError(error instanceof Error ? error.message : 'Unknown error')
    return false
  }
}

async function pollingLoop() {
  while (isRunning) {
    await processBlock()
    await sleep(currentInterval)
  }
}

export function startCollecting() {
  if (isRunning) return

  isRunning = true
  useGasStore.getState().setCollecting(true)
  lastBlockNumber = 0

  pollingLoop()
}

export function stopCollecting() {
  isRunning = false
  if (pollingTimer) {
    clearTimeout(pollingTimer)
    pollingTimer = null
  }
  useGasStore.getState().setCollecting(false)
}

export async function collectOnce(): Promise<boolean> {
  return processBlock()
}
