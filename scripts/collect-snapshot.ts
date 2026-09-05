/**
 * Git-scraper snapshot gas 24 jam — dijalankan Bun, dipanggil GitHub Actions
 * tiap ±1 jam (lihat .github/workflows/collect.yml).
 *
 *   bun scripts/collect-snapshot.ts        (RPC default Robinhood mainnet)
 *   RPC_URL=... bun scripts/collect-snapshot.ts
 *
 * SATU RUN: ambil harga gas + ~30 block terakhir (sequential-safe), receipts,
 * klasifikasi 4 kategori, agregasi → append ke data/snapshots.json (dedupe by
 * block, buang > 24 jam, cap 288 titik).
 *
 * FAIL-SAFE: kegagalan RPC → exit non-zero TANPA menulis file — file lama
 * TIDAK PERNAH ditimpa kosong/datarusak. Import dari src/ HANYA modul murni
 * (tx-classifier, gas-math, snapshot-aggregate) — sengaja TIDAK meng-import
 * rpc-client/chain yang memakai import.meta.env (tidak ada di luar Vite).
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPublicClient, http, type PublicClient } from 'viem'

import { classifyTransaction, TxType, type ClassifiedTransaction } from '../src/data/tx-classifier'
import { calculateTotalFee } from '../src/utils/gas-math'
import {
  aggregateSnapshot,
  mergeSnapshots,
  type SnapshotFile,
} from '../src/data/snapshot-aggregate'

// ─── Konstanta chain (duplikasi sadar dari src/config/chain.ts — sengaja
// TIDAK di-import karena file itu memakai import.meta.env) ───
const DEFAULT_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com/'
const BLOCK_TIME_MS = 100
const WINDOW_BLOCKS = 30
const DATA_PATH = resolve(import.meta.dir, '../data/snapshots.json')

const RPC_URL = process.env.RPC_URL || DEFAULT_RPC_URL

function fail(message: string, error?: unknown): never {
  console.error(`[collect-snapshot] GAGAL: ${message}`)
  if (error instanceof Error) console.error(error.message)
  process.exit(1)
}

function createClient(): PublicClient {
  return createPublicClient({
    transport: http(RPC_URL, {
      timeout: 10_000,
      retryCount: 3,
      retryDelay: 1_000,
    }),
  })
}

/** Ambil receipts satu block: eth_getBlockReceipts (1 request), fallback per-tx bila tidak didukung. */
async function getBlockReceiptsSafe(client: PublicClient, blockNumber: bigint) {
  try {
    return await client.getBlockReceipts({ blockNumber })
  } catch {
    // Fallback: beberapa gateway tidak mendukung eth_getBlockReceipts —
    // ambil per-tx (chunk 20, paralel terkendali, receipt gagal → di-skip).
    const block = await client.getBlock({ blockNumber, includeTransactions: true })
    const hashes = block.transactions.map((tx) => tx.hash)
    const receipts = []
    for (let i = 0; i < hashes.length; i += 20) {
      const chunk = hashes.slice(i, i + 20)
      const settled = await Promise.allSettled(chunk.map((h) => client.getTransactionReceipt({ hash: h })))
      for (const r of settled) {
        if (r.status === 'fulfilled') receipts.push(r.value)
      }
    }
    return receipts
  }
}

async function main(): Promise<void> {
  const client = createClient()

  // ─── 1. Harga gas jaringan (fatal: tanpa ini snapshot tak valid) ───
  let gasPriceWei: bigint
  try {
    gasPriceWei = await client.getGasPrice()
  } catch (error) {
    fail(`eth_gasPrice gagal (${RPC_URL}) — file snapshots.json TIDAK disentuh`, error)
  }

  // ─── 2. Block terbaru (fatal) ───
  let latestNumber: bigint
  try {
    latestNumber = await client.getBlockNumber()
  } catch (error) {
    fail(`eth_blockNumber gagal (${RPC_URL}) — file snapshots.json TIDAK disentuh`, error)
  }

  const startNumber = latestNumber - BigInt(WINDOW_BLOCKS - 1)
  console.log(`[collect-snapshot] Window: block ${startNumber} – ${latestNumber} (${WINDOW_BLOCKS} block)`)

  // ─── 3. Blocks + receipts (sequential per block — aman untuk RPC publik) ───
  const classified: ClassifiedTransaction[] = []
  let collectedBlocks = 0

  for (let n = startNumber; n <= latestNumber; n++) {
    let block
    try {
      block = await client.getBlock({ blockNumber: n, includeTransactions: true })
    } catch (error) {
      fail(`getBlock(${n}) gagal — file snapshots.json TIDAK disentuh`, error)
    }

    let receipts
    try {
      receipts = await getBlockReceiptsSafe(client, n)
    } catch (error) {
      fail(`receipts block ${n} gagal — file snapshots.json TIDAK disentuh`, error)
    }

    const receiptByHash = new Map(receipts.map((r) => [r.transactionHash, r]))
    for (const tx of block.transactions) {
      const receipt = receiptByHash.get(tx.hash)
      if (!receipt || receipt.status !== 'success') continue // tx tanpa receipt → skip (tidak meracuni agregat)
      classified.push({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        input: tx.input,
        value: tx.value,
        gas: tx.gas,
        gasPrice: tx.gasPrice,
        type: tx.type,
        txType: classifyTransaction(tx),
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        fee: calculateTotalFee(receipt.gasUsed, receipt.effectiveGasPrice),
      })
    }
    collectedBlocks += 1
  }

  const nowMs = Date.now()

  // ─── 4. Agregasi (modul murni bersama) ───
  const snapshot = aggregateSnapshot({
    txs: classified,
    blockCount: collectedBlocks,
    blockNumber: Number(latestNumber),
    gasPriceWei,
    blockTimeMs: BLOCK_TIME_MS,
    timestampMs: nowMs,
  })
  console.log(
    `[collect-snapshot] ${classified.length} tx / ${collectedBlocks} block → gas ${snapshot.gasPriceGwei.toFixed(4)} Gwei, tps ${snapshot.tps.toFixed(1)}`,
  )

  // ─── 5. Baca riwayat lama (kalau korup → mulai kosong + warning; file lama
  // memang tidak bisa dipulihkan, dan kita TIDAK PERNAH menulis file kosong
  // saat collector gagal — jalur ini hanya saat sukses koleksi) ───
  let existing: SnapshotFile | null = null
  if (existsSync(DATA_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as SnapshotFile
      if (parsed && Array.isArray(parsed.snapshots)) existing = parsed
    } catch {
      console.warn('[collect-snapshot] WARNING: snapshots.json lama korup — memulai riwayat baru')
    }
  }

  const merged = mergeSnapshots(existing?.snapshots ?? [], [snapshot], nowMs)
  const file: SnapshotFile = { version: 1, updatedAt: new Date(nowMs).toISOString(), snapshots: merged }

  // ─── 6. Tulis (minify — satu baris, ±288 entri maks) ───
  mkdirSync(resolve(DATA_PATH, '..'), { recursive: true })
  writeFileSync(DATA_PATH, JSON.stringify(file), 'utf-8')
  console.log(`[collect-snapshot] OK → ${DATA_PATH} (${merged.length} snapshot, ${Object.values(TxType).length} kategori)`)
}

main().catch((error) => fail('error tak terduga — file snapshots.json TIDAK disentuh', error))
