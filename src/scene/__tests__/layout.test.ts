import { describe, expect, it } from 'vitest'
import { TxType } from '../../data/tx-classifier'
import {
  HEIGHT_UNITS_PER_GWEI,
  MAX_BUILDING_HEIGHT,
  MIN_BUILDING_HEIGHT,
  SPACING,
  TX_TYPES_ORDERED,
  buildingHeight,
  getBuildingPosition,
  indexToPosition,
} from '../layout'

/**
 * Driver tinggi gedung berubah dari avgGasUsed → avgGasPrice (Gwei), RE-ANCHOR
 * ke range nyata Robinhood: 0.1 Gwei dipetakan ke MIN_BUILDING_HEIGHT (7.5),
 * naik linear dengan slope 1 Gwei = 50 m = 50/4.5 unit, clamp 7.5–150. Dipilih
 * agar skyline bervariasi pada gas typ Robinhood (~0.1–0.5 Gwei) sekaligus
 * spike tinggi tetap terbaca (tanpa normalisasi seperti rumus lama).
 */
describe('buildingHeight (driver tinggi = avgGasPrice Gwei, re-anchor)', () => {
  it('re-anchor: 0.1 Gwei → MIN, naik linear @ 1 Gwei = 50 m', () => {
    expect(HEIGHT_UNITS_PER_GWEI).toBeCloseTo(50 / 4.5, 10)
    // Anchor bawah: gas persuasi nyata Robinhood (0.1 Gwei) = tinggi minimum.
    expect(buildingHeight(0.1)).toBe(MIN_BUILDING_HEIGHT)
    // Di atas anchor: slope = HEIGHT_UNITS_PER_GWEI (1 Gwei = 50 m).
    expect(buildingHeight(1)).toBeCloseTo(MIN_BUILDING_HEIGHT + (1 - 0.1) * (50 / 4.5), 10)
    expect(buildingHeight(0.5)).toBeCloseTo(MIN_BUILDING_HEIGHT + 0.4 * (50 / 4.5), 10)
    // Verifikasi slope: beda 0.1→1 Gwei (0.9 Gwei) × HEIGHT_UNITS_PER_GWEI.
    expect(buildingHeight(1) - buildingHeight(0.1)).toBeCloseTo(0.9 * (50 / 4.5), 10)
  })

  it('input invalid/≤0 → MIN (idle: tidak ada data harga)', () => {
    expect(buildingHeight(0)).toBe(MIN_BUILDING_HEIGHT)
    expect(buildingHeight(-3)).toBe(MIN_BUILDING_HEIGHT)
    expect(buildingHeight(NaN)).toBe(MIN_BUILDING_HEIGHT)
  })

  it('clamp ke MIN & MAX (headroom spike gas)', () => {
    // Gas di bawah anchor → dipatok MIN (tidak pernah di bawah MIN).
    expect(buildingHeight(0.05)).toBe(MIN_BUILDING_HEIGHT)
    // 50 Gwei ≈ 555 unit > 150 → MAX.
    expect(buildingHeight(50)).toBe(MAX_BUILDING_HEIGHT)
    // 13.5 Gwei ≈ 156 unit > 150 → MAX (headroom dokumentasi).
    expect(buildingHeight(13.5)).toBe(MAX_BUILDING_HEIGHT)
  })
})

/**
 * Refactor 12 → 4 kategori: grid 4×3 lama tidak berlaku. 4 gedung kini
 * berdiri dalam SATU baris tengah z=0, x = (i − 1.5) × SPACING →
 * {−90, −30, 30, 90} @ SPACING=60 — simetris terhadap plaza.
 */
describe('tata letak 4 gedung (refactor 12→4 kategori)', () => {
  it('TX_TYPES_ORDERED = tepat 4 kategori, urutan display tetap', () => {
    expect(TX_TYPES_ORDERED).toEqual([
      TxType.NATIVE_TRANSFER,
      TxType.ERC20_TRANSFER,
      TxType.SWAP,
      TxType.BRIDGE,
    ])
  })

  it('satu baris z=0, x simetris {−90, −30, 30, 90} @ SPACING=60', () => {
    expect(SPACING).toBe(60)
    const positions = TX_TYPES_ORDERED.map((_, i) => indexToPosition(i))
    expect(positions.map(([x]) => x)).toEqual([-90, -30, 30, 90])
    for (const [, y, z] of positions) {
      expect(y).toBe(0)
      expect(z).toBe(0)
    }
  })

  it('getBuildingPosition memetakan tiap kategori ke baris z=0; tipe asing → origin', () => {
    for (const txType of TX_TYPES_ORDERED) {
      const [x, , z] = getBuildingPosition(txType)
      expect(z).toBe(0)
      expect([-90, -30, 30, 90]).toContain(x)
    }
    expect(getBuildingPosition('tidak_ada' as TxType)).toEqual([0, 0, 0])
  })
})
