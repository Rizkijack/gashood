import { describe, expect, it } from 'vitest'
import { selectNewTxs } from '../particle-spawn'

interface FakeTx {
  hash: string
}

function txs(hashes: string[]): FakeTx[] {
  return hashes.map((hash) => ({ hash }))
}

/**
 * Skenario asal bug: ring buffer penuh (200) lalu tx baru terus masuk.
 * Implementasi LAMA pakai `recentTxs.length > prevCount` — length mentok
 * di 200, spawn mati permanen. Kontrak baru: seleksi HARUS terus
 * mengembalikan tx baru setiap update, selamanya.
 */
function simulateRingBufferUpdates(
  totalNewTxs: number,
  bufferSize: number,
): string[][] {
  // Simulasi store: [...txBaru, ...bufferLama].slice(0, bufferSize)
  const allHashes = Array.from({ length: totalNewTxs }, (_, i) => `0x${String(i).padStart(4, '0')}`)
  let buffer: FakeTx[] = []
  const spawnedPerUpdate: string[][] = []
  let lastHash: string | null = null

  for (let i = 0; i < totalNewTxs; i++) {
    buffer = [{ hash: allHashes[i] }, ...buffer].slice(0, bufferSize)
    const selected = selectNewTxs(buffer, lastHash)
    spawnedPerUpdate.push(selected.map((t) => t.hash))
    if (selected.length > 0) {
      lastHash = buffer[0].hash
    }
  }
  return spawnedPerUpdate
}

describe('selectNewTxs (spawn partikel — anti-regresi ring buffer penuh)', () => {
  it('BUG ASAL: buffer penuh 200 + tx baru terus masuk → spawn TIDAK berhenti', () => {
    const updates = simulateRingBufferUpdates(500, 200)
    // Setelah buffer penuh (update ke-200), setiap update tetap
    // menghasilkan TEPAT 1 tx baru untuk di-spawn.
    for (let i = 200; i < 500; i++) {
      expect(updates[i], `update ke-${i} harus tetap spawn`).toEqual([
        `0x${String(i).padStart(4, '0')}`,
      ])
    }
  })

  it('buffer penuh + beberapa tx baru sekaligus → semuanya terpilih, urut newest-first', () => {
    const buffer = txs(['0xc', '0xb', '0xa'])
    const result = selectNewTxs(buffer, '0xa')
    expect(result.map((t) => t.hash)).toEqual(['0xc', '0xb'])
  })

  it('buffer penuh tanpa tx baru (recentTxs[0] === lastHash) → kosong', () => {
    const buffer = txs(['0xb', '0xa', '0x9'])
    expect(selectNewTxs(buffer, '0xb')).toEqual([])
  })

  it('buffer kosong → kosong (pemanggil mempertahankan hash)', () => {
    expect(selectNewTxs([], '0xabc')).toEqual([])
    expect(selectNewTxs([], null)).toEqual([])
  })

  it('mount pertama (lastHash null) → seluruh buffer terpilih', () => {
    const buffer = txs(['0xc', '0xb', '0xa'])
    expect(selectNewTxs(buffer, null).map((t) => t.hash)).toEqual([
      '0xc',
      '0xb',
      '0xa',
    ])
  })

  it('lastHash tergusur dari buffer (>bufferSize tx baru sejak frame lalu) → full-scan, tidak pernah berhenti', () => {
    const buffer = txs(['0x9', '0x8', '0x7'])
    // lastHash '0x0' sudah tidak ada di buffer → semua dianggap baru
    const result = selectNewTxs(buffer, '0x0')
    expect(result.map((t) => t.hash)).toEqual(['0x9', '0x8', '0x7'])
  })

  it('ukuran buffer kecil (3) dengan 30 tx masuk → seleksi tetap jalan tiap update', () => {
    const updates = simulateRingBufferUpdates(30, 3)
    for (let i = 3; i < 30; i++) {
      expect(updates[i], `update ke-${i} harus tetap spawn`).toEqual([
        `0x${String(i).padStart(4, '0')}`,
      ])
    }
  })
})
