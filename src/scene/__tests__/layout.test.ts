import { describe, expect, it } from 'vitest'
import {
  buildingHeight,
  HEIGHT_UNITS_PER_GWEI,
  MAX_BUILDING_HEIGHT,
  MIN_BUILDING_HEIGHT,
} from '../layout'

/**
 * Driver tinggi gedung berubah dari avgGasUsed → avgGasPrice (Gwei):
 * rasio user 1 Gwei = 50 m; skala dunia 1 unit ≈ 4.5 m (mobil 1.0 unit ≈
 * 4.5 m) → 1 Gwei ≈ 11.11 unit. Linear murni proporsional (tanpa
 * normalisasi seperti rumus lama), clamp 7.5–150 unit.
 */
describe('buildingHeight (driver tinggi = avgGasPrice Gwei)', () => {
  it('rasio linear 1 Gwei = 50 m = 50/4.5 unit', () => {
    expect(HEIGHT_UNITS_PER_GWEI).toBeCloseTo(50 / 4.5, 10)
    expect(buildingHeight(1)).toBeCloseTo(50 / 4.5, 10)
    expect(buildingHeight(2)).toBeCloseTo(100 / 4.5, 10)
    // Proporsional murni: 2× input → 2× output (di bawah clamp).
    expect(buildingHeight(2) / buildingHeight(1)).toBeCloseTo(2, 10)
  })

  it('input invalid/≤0 → MIN (idle: tidak ada data harga)', () => {
    expect(buildingHeight(0)).toBe(MIN_BUILDING_HEIGHT)
    expect(buildingHeight(-3)).toBe(MIN_BUILDING_HEIGHT)
    expect(buildingHeight(NaN)).toBe(MIN_BUILDING_HEIGHT)
  })

  it('clamp ke MIN & MAX (headroom spike gas)', () => {
    // 0.1 Gwei ≈ 1.11 unit < 7.5 → MIN.
    expect(buildingHeight(0.1)).toBe(MIN_BUILDING_HEIGHT)
    // 50 Gwei ≈ 555.5 unit > 150 → MAX.
    expect(buildingHeight(50)).toBe(MAX_BUILDING_HEIGHT)
    // 13.5 Gwei pas di MAX (150 unit ≈ 675 m) — batas headroom dokumentasi.
    expect(buildingHeight(13.5)).toBeCloseTo(MAX_BUILDING_HEIGHT, 10)
  })
})
