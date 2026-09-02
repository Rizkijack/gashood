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

export async function getLatestBlock(): Promise<Block<bigint, true>> {
  const client = getRpcClient()
  return client.getBlock({ includeTransactions: true })
}

export async function getTransactionReceipt(hash: `0x${string}`): Promise<TransactionReceipt | null> {
  const client = getRpcClient()
  try {
    return await client.getTransactionReceipt({ hash })
  } catch {
    return null
  }
}

export async function batchGetReceipts(hashes: `0x${string}`[]): Promise<Map<string, TransactionReceipt>> {
  const receipts = new Map<string, TransactionReceipt>()
  const BATCH_SIZE = 20

  for (let i = 0; i < hashes.length; i += BATCH_SIZE) {
    const batch = hashes.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((hash) => getTransactionReceipt(hash))
    )

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        receipts.set(batch[index], result.value)
      }
    })
  }

  return receipts
}

export async function getGasPrice(): Promise<bigint> {
  const client = getRpcClient()
  return client.getGasPrice()
}
