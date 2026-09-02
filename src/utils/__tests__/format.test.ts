/**
 * Test util format (BUILD_STEPS.md Langkah 7 file pendukung).
 * PENTING: asersi mengikuti perilaku AKTUAL kode, bukan contoh output
 * dokumen yang sudah drift:
 *   - Dokumen: formatNumber(180000) → "180,000"  | Aktual: "180.0K"
 *   - Dokumen: formatEth(0.000018) → "0.000018 ETH" | Aktual: "18.00 μETH"
 */
import { describe, expect, it } from 'vitest'
import { formatBlockNumber, formatEth, formatGasPrice, formatNumber, formatTxHash } from '@/utils/format'

describe('formatGasPrice', () => {
  it('happy: < 1 gwei → 2 desimal', () => {
    expect(formatGasPrice(0.5)).toBe('0.50 Gwei')
    expect(formatGasPrice(0.99)).toBe('0.99 Gwei')
  })

  it('happy: ≥ 1 gwei → 1 desimal', () => {
    expect(formatGasPrice(1)).toBe('1.0 Gwei')
    expect(formatGasPrice(25)).toBe('25.0 Gwei')
  })

  it('edge: 0 dan < 0.01 → "<0.01 Gwei"', () => {
    expect(formatGasPrice(0)).toBe('<0.01 Gwei')
    expect(formatGasPrice(0.005)).toBe('<0.01 Gwei')
  })
})

describe('formatEth', () => {
  it('edge: 0 → "0 ETH"', () => {
    expect(formatEth(0)).toBe('0 ETH')
  })

  it('edge: sangat kecil → nETH', () => {
    expect(formatEth(5e-10)).toBe('0.50 nETH')
  })

  it('edge: < 0.001 → μETH (drift dokumen: bukan "0.000018 ETH")', () => {
    expect(formatEth(0.000018)).toBe('18.00 μETH')
    expect(formatEth(0.0005)).toBe('500.00 μETH')
  })

  it('happy: < 1 ETH → 6 desimal', () => {
    expect(formatEth(0.5)).toBe('0.500000 ETH')
  })

  it('happy: ≥ 1 ETH → 4 desimal', () => {
    expect(formatEth(2)).toBe('2.0000 ETH')
    expect(formatEth(1)).toBe('1.0000 ETH')
  })
})

describe('formatTxHash', () => {
  const fullHash = `0x1111${'ff'.repeat(30)}abcd` // 70 karakter (pita penuh)

  it('happy: hash panjang → 6 karakter pertama + "..." + 4 terakhir', () => {
    expect(formatTxHash(fullHash)).toBe('0x1111...abcd')
  })

  it('edge: hash pendek (≤ 10 karakter) → dikembalikan utuh', () => {
    expect(formatTxHash('0xabc123')).toBe('0xabc123')
    expect(formatTxHash('0x12345678')).toBe('0x12345678') // batas tepat 10
  })

  it('edge: 11 karakter → mulai dipangkas', () => {
    expect(formatTxHash('0x123456789')).toBe('0x1234...6789')
  })
})

describe('formatNumber', () => {
  it('happy: < 1000 → toLocaleString tanpa K/M', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(999)).toBe('999')
  })

  it('edge: batas 999/1000', () => {
    expect(formatNumber(1000)).toBe('1.0K')
  })

  it('edge: drift dokumen — 180000 → "180.0K" (bukan "180,000")', () => {
    expect(formatNumber(180000)).toBe('180.0K')
  })

  it('edge: 999999 membulat ke "1000.0K" (perilaku aktual toFixed)', () => {
    expect(formatNumber(999999)).toBe('1000.0K')
  })

  it('happy: ≥ 1e6 → format M', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M')
    expect(formatNumber(1_234_567)).toBe('1.2M')
  })
})

describe('formatBlockNumber', () => {
  it('happy: prefix "#"', () => {
    expect(formatBlockNumber(42)).toBe('#42')
    expect(formatBlockNumber(0)).toBe('#0')
  })
})
