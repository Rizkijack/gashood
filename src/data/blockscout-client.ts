import { ROBINHOOD_CHAIN } from '@/config/chain'

const BASE_URL = ROBINHOOD_CHAIN.blockscoutApi

async function fetchJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Accept': 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Blockscout API error: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export interface BlockscoutStats {
  total_blocks: string
  total_addresses: string
  total_transactions: string
  average_block_time: number
  coin_price: string
  network_utilization_percentage: number
  gas_prices: {
    slow: number
    average: number
    fast: number
  }
}

export interface BlockscoutTransaction {
  hash: string
  type: number
  from: { hash: string }
  to: { hash: string } | null
  value: string
  gas_used: string
  gas_price: string
  fee: { type: string; value: string } | null
  method: string | null
  tx_types: string[]
  status: string
  block: number
  timestamp: string
}

export interface BlockscoutTransactionSummary {
  data: {
    summaries: Array<{
      summary_template: string
      summary_template_variables: Record<string, { type: string; value: string }>
    }>
  }
}

export async function getStats(): Promise<BlockscoutStats> {
  return fetchJson<BlockscoutStats>('/stats')
}

export async function getRecentTransactions(limit: number = 50): Promise<BlockscoutTransaction[]> {
  const data = await fetchJson<{ items: BlockscoutTransaction[] }>(
    `/transactions?type=validated&limit=${limit}`
  )
  return data.items
}

export async function getTransactionSummary(hash: string): Promise<BlockscoutTransactionSummary> {
  return fetchJson<BlockscoutTransactionSummary>(`/transactions/${hash}/summary`)
}
