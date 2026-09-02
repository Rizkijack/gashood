import { createPublicClient, http, type PublicClient, type Block, type TransactionReceipt } from 'viem'
import { ROBINHOOD_CHAIN } from '@/config/chain'

let client: PublicClient | null = null

export function getRpcClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: {
        id: ROBINHOOD_CHAIN.id,
        name: ROBINHOOD_CHAIN.name,
        nativeCurrency: ROBINHOOD_CHAIN.nativeCurrency,
        rpcUrls: {
          default: { http: [ROBINHOOD_CHAIN.rpcUrl] },
          public: { http: [ROBINHOOD_CHAIN.rpcUrl] },
        },
        blockExplorers: {
          default: { name: 'Blockscout', url: ROBINHOOD_CHAIN.blockExplorer },
        },
      },
      transport: http(ROBINHOOD_CHAIN.rpcUrl, {
        timeout: 10_000,
        retryCount: 3,
        retryDelay: 1_000,
      }),
    })
  }
  return client
}

export async function getBlock(blockNumber: bigint | 'latest'): Promise<Block<bigint, true>> {
  const client = getRpcClient()
  return client.getBlock({
    blockNumber: blockNumber === 'latest' ? undefined : blockNumber,
    includeTransactions: true,
  })
}

export async function getLatestBlock(): Promise<Block<bigint, true>> {
  return getBlock('latest')
}

export async function getLatestBlockNumber(): Promise<bigint> {
  const client = getRpcClient()
  return client.getBlockNumber()
}

export async function getTransactionReceipt(hash: `0x${string}`): Promise<TransactionReceipt | null> {
  const client = getRpcClient()
  try {
    return await client.getTransactionReceipt({ hash })
  } catch {
    return null
  }
}

/**
 * Cap konkurensi antar-chunk: maks 4 chunk in-flight sekaligus.
 * 4 chunk × 20 hash/chunk (BATCH_SIZE) = ±80 request paralel maks — tanpa cap,
 * block berat (500 tx → 25 chunk) meledakkan RPC dengan 500 request seketika → 429.
 */
const MAX_CONCURRENT_CHUNKS = 4

export async function batchGetReceipts(hashes: `0x${string}`[]): Promise<Map<string, TransactionReceipt>> {
  const receipts = new Map<string, TransactionReceipt>()
  const BATCH_SIZE = 20

  // Chunk dulu (maks 20 hash per chunk), lalu proses chunk secara PARALEL
  // dengan cap konkurensi: worker-pool sederhana — MAX_CONCURRENT_CHUNKS
  // worker, masing-masing mengambil chunk berikutnya yang masih antri. 4
  // worker × 20 hash/chunk = ±80 request paralel maks, jadi block berat
  // (500 tx → 25 chunk) tidak lagi meledakkan RPC (→ 429), sementara
  // paralelisme antar-chunk tetap ada (naik dari serial lama yang mentok 20).
  //
  // Sengaja TIDAK memakai viem batch transport (createPublicClient batch config):
  // kompatibilitas JSON-RPC batching di server RPC Robinhood belum terjamin
  // (bisa 404/400 di beberapa gateway), jadi batching manual per-request
  // lebih aman. Perilaku graceful dipertahankan: receipt gagal → di-skip, tidak throw.
  const chunks: `0x${string}`[][] = []
  for (let i = 0; i < hashes.length; i += BATCH_SIZE) {
    chunks.push(hashes.slice(i, i + BATCH_SIZE))
  }

  // Single-threaded JS: baca lalu increment `nextChunk` tanpa await di antaranya → aman.
  let nextChunk = 0
  const worker = async (): Promise<void> => {
    while (nextChunk < chunks.length) {
      const chunk = chunks[nextChunk++]
      const results = await Promise.allSettled(chunk.map((hash) => getTransactionReceipt(hash)))
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          receipts.set(chunk[index], result.value)
        }
      })
    }
  }

  // Worker tidak pernah reject (allSettled di dalam) — allSettled hanya guard defensif.
  await Promise.allSettled(
    Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, chunks.length) }, () => worker())
  )

  return receipts
}

export async function getGasPrice(): Promise<bigint> {
  const client = getRpcClient()
  return client.getGasPrice()
}
