import { getBlock, getGasPrice, getLatestBlockNumber, batchGetReceipts } from '@/data/rpc-client'
import { getStats, type BlockscoutStats } from '@/data/blockscout-client'
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

/**
 * Generation token anti double-loop (race React StrictMode).
 * StrictMode: cleanup `stopCollecting` lalu remount `startCollecting` di tick yang
 * sama. Tanpa token, loop lama yang sedang tidur di `sleep()` bangun, melihat
 * `isRunning` sudah `true` lagi (oleh start yang baru) → lanjut jalan → 2 loop
 * concurrent. Dengan token: setiap start menaikkan `runId`; loop lama yang punya
 * `myRun` lama mati di pemeriksaan pertama setelah SETIAP await.
 */
let runId = 0

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

/** Jarak minimum antar permintaan harga ke Blockscout /stats. */
const PRICE_FETCH_INTERVAL_MS = 60_000
let lastPriceFetchAt = 0

/**
 * Murni: parse `coin_price` Blockscout (string desimal) → number, atau null
 * bila tidak valid — termasuk harga <= 0: nilai "0"/negatif dari API rusak
 * tidak boleh meracuni semua tampilan USD. UI menyembunyikan bagian USD
 * saat null.
 */
export function parseCoinPrice(raw: string): number | null {
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Murni: parse `gas_prices` Blockscout (data yang sama dengan halaman
 * /gas-tracker) → ambil nilai `average` (Gwei), atau null bila tidak valid —
 * termasuk 0/negatif/NaN: nilai rusak tidak boleh jadi SUMBER UTAMA
 * currentGasPrice (UI akan fallback ke eth_gasPrice RPC).
 */
export function parseGasPriceFromStats(
  gasPrices: BlockscoutStats['gas_prices'] | undefined
): number | null {
  const average = gasPrices?.average
  return average !== undefined && Number.isFinite(average) && average > 0 ? average : null
}

/**
 * Refresh harga ETH (USD) + gas price real-time dari Blockscout /stats —
 * MAKSIMAL sekali per 60 detik, SATU fetch untuk keduanya (TANPA request
 * tambahan; gas_prices datang dari response yang sama dengan coin_price).
 * NON-FATAL: kegagalan fetch hanya console.warn, TIDAK mengganggu loop block,
 * TIDAK menaikkan consecutiveFailures polling block.
 * (Diekspor untuk test; perilaku internal tetap sama.)
 */
export async function refreshEthPriceIfDue(myRun: number): Promise<void> {
  const now = Date.now()
  if (now - lastPriceFetchAt < PRICE_FETCH_INTERVAL_MS) return
  // Timestamp di-set saat MENCOBA (bukan setelah sukses) agar kegagalan pun
  // tidak menembak Blockscout tiap 3 detik — retry paling cepat 60s berikutnya.
  lastPriceFetchAt = now

  try {
    const stats = await getStats()
    // Audit B6-consistency: jangan tulis store dari generation lama / setelah stop.
    if (myRun !== runId || !isRunning) return
    const price = parseCoinPrice(stats.coin_price)
    if (price !== null) {
      useGasStore.getState().setEthUsdPrice(price)
    }
    // gas_prices.average (Blockscout gas tracker, sumber utama currentGasPrice)
    // ditulis HANYA setelah guard generation di atas — sama-sama non-fatal.
    const gasPriceGwei = parseGasPriceFromStats(stats.gas_prices)
    if (gasPriceGwei !== null) {
      useGasStore.getState().setBlockscoutGasPrice(gasPriceGwei)
    }
    // Kepadatan traffic (%) dari response yang SAMA (network_utilization_percentage)
    // — sinyal jumlah mobil di scene 3D. Zero request tambahan.
    const utilization = stats.network_utilization_percentage
    if (typeof utilization === 'number' && Number.isFinite(utilization) && utilization >= 0) {
      useGasStore.getState().setTrafficDensity(utilization)
    }
  } catch (error) {
    console.warn('[gas-collector] Gagal fetch harga ETH dari Blockscout (non-fatal):', error)
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
async function runCycle(myRun: number): Promise<boolean> {
  try {
    const blockNumber = await getLatestBlockNumber()

    // Stale generation / sudah stop → jangan lanjut.
    if (myRun !== runId || !isRunning) {
      return true
    }

    if (blockNumber === lastBlockNumber) {
      adaptInterval(true)
      return true
    }

    const [txs, gasPriceWei] = await Promise.all([processBlock(blockNumber), getGasPrice()])

    // Audit B6: stop() bisa dipanggil saat request in-flight — jangan tulis ke
    // store setelah stop ATAU dari generation lama (race StrictMode).
    if (myRun !== runId || !isRunning) {
      return true
    }

    lastBlockNumber = blockNumber

    if (txs.length > 0) {
      useGasStore.getState().updateFromBlock(txs, Number(blockNumber), gasPriceWei)
    }

    // Harga ETH (enrichment, non-fatal): fire-and-forget — JANGAN await.
    // Blockscout bisa menggantung sampai 10s (AbortSignal.timeout); await di
    // sini menunda cadence blok 3s untuk data yang sekadar memperkaya UI.
    // Aman dari unhandled rejection karena try/catch ada DI DALAM
    // refreshEthPriceIfDue — promise-nya tidak pernah reject, kegagalan tidak
    // pernah sampai catch blok bawah, jadi consecutiveFailures polling block
    // tetap tak tersentuh.
    void refreshEthPriceIfDue(myRun)

    adaptInterval(true)
    // Audit B5: baca ulang error SETELAH await (bukan snapshot lama).
    if (useGasStore.getState().error) {
      useGasStore.getState().setError(null)
    }

    // Sukses → reset hitungan kegagalan beruntun (dipakai ErrorToast L31).
    if (useGasStore.getState().consecutiveFailures !== 0) {
      useGasStore.getState().setConsecutiveFailures(0)
    }

    return true
  } catch (error) {
    // Generation lama / sudah stop → jangan tulis error stale ke store.
    if (myRun !== runId || !isRunning) {
      return false
    }
    adaptInterval(false)
    const state = useGasStore.getState()
    state.setError(error instanceof Error ? error.message : 'Unknown error')
    // Increment kegagalan beruntun — ErrorToast pakai ini untuk pesan "data cache".
    state.setConsecutiveFailures(state.consecutiveFailures + 1)
    return false
  }
}

async function pollingLoop(myRun: number): Promise<void> {
  while (isRunning && myRun === runId) {
    await runCycle(myRun)
    if (!isRunning || myRun !== runId) break // audit B6 + race StrictMode
    await sleep(currentInterval)
    // Bangun dari sleep: generation bisa sudah diganti (stop lalu start remount
    // di tick sama) — loop lama HARUS mati di sini, bukan lanjut iterasi.
    if (!isRunning || myRun !== runId) break
  }
}

export function startCollecting(): void {
  if (isRunning) return
  // Catatan urutan: `++runId` SETELAH guard di atas. Double-start tanpa stop
  // tidak boleh meng-invalidate loop yang sedang sehat; sedangkan alur
  // StrictMode (stop → start) selalu lewat karena stop mematikan isRunning.
  isRunning = true
  lastBlockNumber = 0n
  const myRun = ++runId
  useGasStore.getState().setCollecting(true)

  void pollingLoop(myRun)
}

export function stopCollecting(): void {
  isRunning = false
  useGasStore.getState().setCollecting(false)
}

export async function collectOnce(): Promise<boolean> {
  // One-shot manual: pakai generation berjalan (atau terakhir) agar guard
  // stale-store tetap konsisten — tidak menulis ke store setelah stop.
  return runCycle(runId)
}
