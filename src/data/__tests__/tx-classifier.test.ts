/**
 * Test klasifikasi transaksi (BUILD_STEPS.md Langkah 7).
 * 5 kasus dokumen + edge case. Asersi mengikuti perilaku AKTUAL kode.
 */
import { describe, expect, it } from 'vitest'
import { classifyTransaction, TxType, type TransactionData } from '@/data/tx-classifier'

function makeTx(overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    hash: `0x${'aa'.repeat(32)}`,
    from: `0x${'bb'.repeat(20)}`,
    to: `0x${'cc'.repeat(20)}`,
    input: '0x',
    value: 1n,
    gas: 21_000n,
    ...overrides,
  }
}

// 4-byte selector + word argumen 32 byte (pola calldata kontrak)
const ERC20_TRANSFER_INPUT = `0xa9059cbb${'11'.repeat(32)}`
const DEX_SWAP_INPUT = `0x38ed1739${'22'.repeat(32)}`
const UNKNOWN_SELECTOR_INPUT = `0xdeadbeef${'33'.repeat(32)}`

describe('classifyTransaction (Langkah 7) — 5 kasus dokumen', () => {
  it('input "0x" → NATIVE_TRANSFER', () => {
    expect(classifyTransaction(makeTx({ input: '0x' }))).toBe(TxType.NATIVE_TRANSFER)
  })

  it('input "0xa9059cbb..." → ERC20_TRANSFER', () => {
    expect(classifyTransaction(makeTx({ input: ERC20_TRANSFER_INPUT }))).toBe(TxType.ERC20_TRANSFER)
  })

  it('input "0x38ed1739..." → DEX_SWAP', () => {
    expect(classifyTransaction(makeTx({ input: DEX_SWAP_INPUT }))).toBe(TxType.DEX_SWAP)
  })

  it('to === null → CONTRACT_DEPLOY (prioritas lebih tinggi dari calldata)', () => {
    expect(classifyTransaction(makeTx({ to: null, input: '0x' }))).toBe(TxType.CONTRACT_DEPLOY)
    // Dokumen: cek to === null adalah langkah 1 — meski calldata dikenali,
    // hasilnya tetap deploy, bukan ERC20_TRANSFER.
    expect(classifyTransaction(makeTx({ to: null, input: ERC20_TRANSFER_INPUT }))).toBe(
      TxType.CONTRACT_DEPLOY
    )
  })

  it('selector tak dikenal → CONTRACT_CALL (fallback)', () => {
    expect(classifyTransaction(makeTx({ input: UNKNOWN_SELECTOR_INPUT }))).toBe(TxType.CONTRACT_CALL)
  })
})

describe('classifyTransaction (Langkah 7) — edge cases', () => {
  it('selector uppercase dinormalisasi ke lowercase', () => {
    // extractSelector() memanggil .toLowerCase() sebelum lookup
    const uppercaseInput = `0xA9059CBB${'11'.repeat(32)}`
    expect(classifyTransaction(makeTx({ input: uppercaseInput }))).toBe(TxType.ERC20_TRANSFER)
  })

  it('input pendek "0x1234" (< 4 byte selector) → CONTRACT_CALL', () => {
    // Panjang < 10 karakter → selector tidak bisa diekstrak → fallback
    expect(classifyTransaction(makeTx({ input: '0x1234' }))).toBe(TxType.CONTRACT_CALL)
  })

  it('input string kosong "" → NATIVE_TRANSFER', () => {
    expect(classifyTransaction(makeTx({ input: '' }))).toBe(TxType.NATIVE_TRANSFER)
  })

  it('to undefined saat runtime → diperlakukan seperti tx biasa (bukan deploy)', () => {
    // Defensif: `tx.to === null` tidak mencakup undefined — tidak boleh
    // salah diklasifikasi sebagai CONTRACT_DEPLOY, dan tidak boleh crash.
    const tx = makeTx({ input: '0x' })
    ;(tx as { to?: string | null }).to = undefined
    expect(classifyTransaction(tx)).toBe(TxType.NATIVE_TRANSFER)

    const txWithCalldata = makeTx({ input: ERC20_TRANSFER_INPUT })
    ;(txWithCalldata as { to?: string | null }).to = undefined
    expect(classifyTransaction(txWithCalldata)).toBe(TxType.ERC20_TRANSFER)
  })
})
