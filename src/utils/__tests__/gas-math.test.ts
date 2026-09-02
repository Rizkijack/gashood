/**
 * Test util gas math (BUILD_STEPS.md Langkah 7 file pendukung).
 * Catatan drift dokumen: BUILD_STEPS.md menyebut `calculateFee(gasUsed,
 * effectiveGasPrice)` — nama aktual di kode adalah `calculateTotalFee`.
 * Asersi mengikuti perilaku AKTUAL kode.
 */
import { describe, expect, it } from 'vitest'
import { calculateTotalFee, ethToUsd, gweiToEth, weiToEth, weiToGwei } from '@/utils/gas-math'

describe('calculateTotalFee (dokumen: "calculateFee")', () => {
  it('happy: 21000 gas × 1 gwei', () => {
    expect(calculateTotalFee(21_000n, 1_000_000_000n)).toBe(21_000_000_000_000n)
  })

  it('edge: 0 × 0 → 0n', () => {
    expect(calculateTotalFee(0n, 0n)).toBe(0n)
  })

  it('edge: bigint besar (> 2^53) tetap presisi karena bigint', () => {
    // 2^53 melewati Number.MAX_SAFE_INTEGER — hasil 2^63 tetap eksak.
    const gas = 1n << 53n
    const price = 1n << 10n
    expect(calculateTotalFee(gas, price)).toBe(1n << 63n) // 9223372036854775808n
  })
})

describe('weiToGwei', () => {
  it('happy: 1 gwei = 1e9 wei', () => {
    expect(weiToGwei(1_000_000_000n)).toBe(1)
  })

  it('edge: 0n → 0', () => {
    expect(weiToGwei(0n)).toBe(0)
  })

  it('edge: nilai kecil fraksional', () => {
    expect(weiToGwei(123n)).toBeCloseTo(1.23e-7, 15)
  })

  it('edge: bigint besar > 2^53', () => {
    // 2^53 wei = 9_007_199.254740992 gwei
    expect(weiToGwei(1n << 53n)).toBeCloseTo(9_007_199.254740992, 6)
  })
})

describe('weiToEth', () => {
  it('happy: 1 ETH = 1e18 wei', () => {
    expect(weiToEth(1_000_000_000_000_000_000n)).toBe(1)
  })

  it('edge: 0n → 0', () => {
    expect(weiToEth(0n)).toBe(0)
  })

  it('edge: bigint besar > 2^53 (konversi Number — presisi hilang di bawah satuan wei)', () => {
    // 2^60 wei = 1.152921504606846976 ETH
    expect(weiToEth(1n << 60n)).toBeCloseTo(1.152921504606846976, 12)
  })
})

describe('gweiToEth', () => {
  it('happy: 1 gwei = 1e-9 ETH', () => {
    expect(gweiToEth(1)).toBeCloseTo(1e-9, 15)
  })

  it('edge: 0 → 0', () => {
    expect(gweiToEth(0)).toBe(0)
  })
})

describe('ethToUsd', () => {
  it('happy: 2 ETH × $3000 = $6000', () => {
    expect(ethToUsd(2, 3000)).toBe(6000)
  })

  it('edge: 0 ETH → $0', () => {
    expect(ethToUsd(0, 3000)).toBe(0)
  })
})
