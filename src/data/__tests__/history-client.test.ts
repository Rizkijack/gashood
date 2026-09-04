/**
 * Test riwayat 24 jam (git-scraping): parser frontend `parseSnapshots`,
 * agregasi murni `aggregateSnapshot`, dan penggabungan `mergeSnapshots`
 * (modul bersama src/data/snapshot-aggregate.ts — dipakai script Bun collector,
 * frontend, dan test ini: single source of truth).
 */
import { describe, expect, it } from 'vitest'
import { TxType, type ClassifiedTransaction } from '@/data/tx-classifier'
import {
  MAX_SNAPSHOTS,
  aggregateSnapshot,
  mergeSnapshots,
  type GasSnapshot,
  type SnapshotFile,
} from '@/data/snapshot-aggregate'
import { parseSnapshots } from '@/data/history-client'

// ─── Builder ──────────────────────────────────────────────────────────

/** Tx terklasifikasi sintetis (wei) — fee = gasUsed × gasPrice. */
function makeTx(type: TxType, gasUsed: number, gasPriceWei: bigint): ClassifiedTransaction {
  return {
    hash: `0x${type}${gasUsed}`,
    from: '0x0000000000000000000000000000000000000001',
    to: '0x0000000000000000000000000000000000000002',
    input: type === TxType.NATIVE_TRANSFER ? '0x' : '0xa9059cbb',
    value: 1n,
    gas: BigInt(gasUsed),
    gasPrice: gasPriceWei,
    type: '0x0',
    txType: type,
    gasUsed: BigInt(gasUsed),
    effectiveGasPrice: gasPriceWei,
    fee: BigInt(gasUsed) * gasPriceWei,
  }
}

/** Snapshot valid minimal dengan override per-field. */
function makeSnapshot(overrides: Partial<GasSnapshot> = {}): GasSnapshot {
  return {
    t: '2026-09-04T08:00:00.000Z',
    block: 1000,
    gasPriceGwei: 0.38,
    tps: 120,
    categories: {
      [TxType.NATIVE_TRANSFER]: {
        avgGasUsed: 21000,
        avgGasPrice: 0.38,
        minGasPrice: 0.37,
        maxGasPrice: 0.39,
        totalTxCount: 10,
        totalFeeEth: 0.0001,
      },
      [TxType.ERC20_TRANSFER]: {
        avgGasUsed: 57000,
        avgGasPrice: 0.38,
        minGasPrice: 0.37,
        maxGasPrice: 0.39,
        totalTxCount: 5,
        totalFeeEth: 0.0002,
      },
      [TxType.SWAP]: {
        avgGasUsed: 350000,
        avgGasPrice: 0.38,
        minGasPrice: 0.37,
        maxGasPrice: 0.39,
        totalTxCount: 3,
        totalFeeEth: 0.0003,
      },
      [TxType.BRIDGE]: {
        avgGasUsed: 42000,
        avgGasPrice: 0.38,
        minGasPrice: 0.37,
        maxGasPrice: 0.39,
        totalTxCount: 1,
        totalFeeEth: 0.0004,
      },
    },
    ...overrides,
  }
}

// ─── parseSnapshots (frontend history-client) ────────────────────────

describe('parseSnapshots', () => {
  it('menerima file valid dan mengembalikan SnapshotFile', () => {
    const raw: SnapshotFile = { version: 1, updatedAt: '2026-09-04T08:05:00.000Z', snapshots: [makeSnapshot()] }
    const parsed = parseSnapshots(JSON.parse(JSON.stringify(raw)))
    expect(parsed).not.toBeNull()
    expect(parsed?.version).toBe(1)
    expect(parsed?.snapshots).toHaveLength(1)
    expect(parsed?.snapshots[0].block).toBe(1000)
  })

  it('menolak input bukan object (null, string, array)', () => {
    expect(parseSnapshots(null)).toBeNull()
    expect(parseSnapshots('rusak')).toBeNull()
    expect(parseSnapshots(42)).toBeNull()
    expect(parseSnapshots([makeSnapshot()])).toBeNull()
  })

  it('menolak version tak dikenal dan snapshots bukan array', () => {
    expect(parseSnapshots({ version: 2, snapshots: [] })).toBeNull()
    expect(parseSnapshots({ version: 1, snapshots: 'rusak' })).toBeNull()
    expect(parseSnapshots({ version: 1 })).toBeNull()
  })

  it('me-skip entry invalid dan tetap memakai entry valid', () => {
    const broken = makeSnapshot({ t: 'bukan-iso' }) // t invalid → skip
    const negative = makeSnapshot({ block: 2000, gasPriceGwei: -1 }) // harga negatif → skip
    const good = makeSnapshot({ block: 3000 })
    const parsed = parseSnapshots({ version: 1, updatedAt: 'x', snapshots: [broken, negative, good] })
    expect(parsed?.snapshots).toHaveLength(1)
    expect(parsed?.snapshots[0].block).toBe(3000)
  })

  it('entry dengan kategori hilang / field NaN → invalid', () => {
    const missingCategory = makeSnapshot()
    delete (missingCategory.categories as Record<string, unknown>)[TxType.BRIDGE]

    const nanField = makeSnapshot()
    ;(nanField.categories as Record<string, unknown>)[TxType.SWAP] = {
      avgGasUsed: NaN,
      avgGasPrice: 0.1,
      minGasPrice: 0,
      maxGasPrice: 0,
      totalTxCount: 1,
      totalFeeEth: 0,
    }

    expect(parseSnapshots({ version: 1, updatedAt: 'x', snapshots: [missingCategory] })).toBeNull()
    expect(parseSnapshots({ version: 1, updatedAt: 'x', snapshots: [nanField] })).toBeNull()
  })

  it('snapshots kosong / semua entry invalid → null (tidak ada yang berguna)', () => {
    expect(parseSnapshots({ version: 1, updatedAt: 'x', snapshots: [] })).toBeNull()
    expect(parseSnapshots({ version: 1, updatedAt: 'x', snapshots: [{ t: 'x' }] })).toBeNull()
  })
})

// ─── aggregateSnapshot (dipakai scripts/collect-snapshot.ts) ─────────

describe('aggregateSnapshot', () => {
  const GWEI = 1_000_000_000n

  it('mengagregasi 4 kategori: avg/min/max/count/fee + gasPrice + tps', () => {
    const txs = [
      makeTx(TxType.NATIVE_TRANSFER, 21000, 1n * GWEI), // 1 gwei
      makeTx(TxType.NATIVE_TRANSFER, 21000, 3n * GWEI), // 3 gwei
      makeTx(TxType.SWAP, 300000, 2n * GWEI), // 2 gwei
    ]
    const snap = aggregateSnapshot({
      txs,
      blockCount: 2, // 2 block × 100ms = 0.2s → tps = 3/0.2 = 15
      blockNumber: 5000,
      gasPriceWei: 1500000000n, // 1.5 gwei
      blockTimeMs: 100,
      timestampMs: Date.parse('2026-09-04T08:00:00.000Z'),
    })

    expect(snap.block).toBe(5000)
    expect(snap.gasPriceGwei).toBeCloseTo(1.5, 9)
    expect(snap.tps).toBeCloseTo(15, 6)
    expect(snap.t).toBe('2026-09-04T08:00:00.000Z')

    const native = snap.categories[TxType.NATIVE_TRANSFER]
    expect(native.totalTxCount).toBe(2)
    expect(native.avgGasPrice).toBeCloseTo(2, 9) // (1+3)/2
    expect(native.minGasPrice).toBeCloseTo(1, 9)
    expect(native.maxGasPrice).toBeCloseTo(3, 9)
    expect(native.avgGasUsed).toBeCloseTo(21000, 6)
    // fee total = 21000×1 gwei + 21000×3 gwei = 84000 gwei = 0.000084 ETH
    expect(native.totalFeeEth).toBeCloseTo(0.000084, 18)

    const swap = snap.categories[TxType.SWAP]
    expect(swap.totalTxCount).toBe(1)
    expect(swap.avgGasPrice).toBeCloseTo(2, 9)
  })

  it('tx harga 0 (tanpa receipt valid) dihitung di count tapi tidak meracuni avg/min/max', () => {
    const txs = [
      makeTx(TxType.ERC20_TRANSFER, 57000, 2n * GWEI),
      makeTx(TxType.ERC20_TRANSFER, 57000, 0n), // harga 0 → skip dari min/avg/max
    ]
    const snap = aggregateSnapshot({
      txs,
      blockCount: 1,
      blockNumber: 1,
      gasPriceWei: 1n,
      blockTimeMs: 100,
      timestampMs: 0,
    })

    const erc20 = snap.categories[TxType.ERC20_TRANSFER]
    expect(erc20.totalTxCount).toBe(2)
    expect(erc20.avgGasPrice).toBeCloseTo(2, 9)
    expect(erc20.minGasPrice).toBeCloseTo(2, 9)
    expect(erc20.maxGasPrice).toBeCloseTo(2, 9)
  })

  it('kategori tanpa tx → semua 0 (BUKAN Infinity/NaN — aman untuk JSON)', () => {
    const snap = aggregateSnapshot({
      txs: [makeTx(TxType.NATIVE_TRANSFER, 21000, 1n * GWEI)],
      blockCount: 1,
      blockNumber: 1,
      gasPriceWei: 1n,
      blockTimeMs: 100,
      timestampMs: 0,
    })

    const bridge = snap.categories[TxType.BRIDGE]
    expect(bridge.totalTxCount).toBe(0)
    expect(bridge.avgGasPrice).toBe(0)
    expect(bridge.minGasPrice).toBe(0)
    expect(bridge.maxGasPrice).toBe(0)
    expect(JSON.parse(JSON.stringify(snap))).toBeTruthy() // stringify tidak menghasilkan null liar
  })
})

// ─── mergeSnapshots (dedupe + retensi 24 jam) ────────────────────────

describe('mergeSnapshots', () => {
  const NOW = Date.parse('2026-09-04T08:00:00.000Z')
  const HOUR = 60 * 60 * 1000

  it('dedupe by block: snapshot BARU menimpa lama bila block sama', () => {
    const old = makeSnapshot({ t: new Date(NOW - HOUR).toISOString(), block: 100, gasPriceGwei: 0.1 })
    const fresh = makeSnapshot({ t: new Date(NOW).toISOString(), block: 100, gasPriceGwei: 0.2 })
    const merged = mergeSnapshots([old], [fresh], NOW)
    expect(merged).toHaveLength(1)
    expect(merged[0].gasPriceGwei).toBe(0.2)
  })

  it('membuang snapshot > 24 jam dan mengurutkan naik by t', () => {
    const stale = makeSnapshot({ t: new Date(NOW - 25 * HOUR).toISOString(), block: 1 })
    const ok = makeSnapshot({ t: new Date(NOW - HOUR).toISOString(), block: 2 })
    const fresh = makeSnapshot({ t: new Date(NOW).toISOString(), block: 3 })
    const merged = mergeSnapshots([stale, ok], [fresh], NOW)
    expect(merged.map((s) => s.block)).toEqual([2, 3]) // stale terbuang, urut naik
  })

  it('cap ±288 titik: menyimpan snapshot TERBARU saja', () => {
    const existing: GasSnapshot[] = []
    for (let i = 0; i < MAX_SNAPSHOTS + 50; i++) {
      existing.push(makeSnapshot({ t: new Date(NOW - (MAX_SNAPSHOTS + 50 - i) * 60_000).toISOString(), block: i }))
    }
    const merged = mergeSnapshots(existing, [], NOW)
    expect(merged).toHaveLength(MAX_SNAPSHOTS)
    expect(merged[merged.length - 1].block).toBe(MAX_SNAPSHOTS + 49) // yang terbaru
  })
})
