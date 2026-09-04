/**
 * Test klasifikasi transaksi (BUILD_STEPS.md Langkah 7).
 * Refactor 12 → 4 kategori: asersi lama yang menargetkan DEX_SWAP /
 * CONTRACT_DEPLOY / CONTRACT_CALL / NFT_* / LIQUIDITY / ERC20_APPROVE
 * di-rewrite ke kategori baru (SWAP / BRIDGE / ERC20_TRANSFER).
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

  it('input "0x38ed1739..." (dex swap) → SWAP (refactor 12→4: DEX_SWAP melebur ke SWAP)', () => {
    expect(classifyTransaction(makeTx({ input: DEX_SWAP_INPUT }))).toBe(TxType.SWAP)
  })

  it('to === null → SWAP (deploy; eks CONTRACT_DEPLOY melebur ke SWAP — prioritas lebih tinggi dari calldata)', () => {
    expect(classifyTransaction(makeTx({ to: null, input: '0x' }))).toBe(TxType.SWAP)
    // Dokumen: cek to === null adalah langkah 1 — meski calldata dikenali,
    // hasilnya tetap deploy → kini SWAP, bukan ERC20_TRANSFER.
    expect(classifyTransaction(makeTx({ to: null, input: ERC20_TRANSFER_INPUT }))).toBe(
      TxType.SWAP
    )
  })

  it('selector tak dikenal → SWAP (fallback; eks CONTRACT_CALL melebur ke SWAP)', () => {
    expect(classifyTransaction(makeTx({ input: UNKNOWN_SELECTOR_INPUT }))).toBe(TxType.SWAP)
  })
})

describe('classifyTransaction (refactor 12→4) — pemetaan signature lama ke kategori baru', () => {
  it('approve 0x095ea7b3 → SWAP (eks ERC20_APPROVE)', () => {
    expect(classifyTransaction(makeTx({ input: `0x095ea7b3${'44'.repeat(32)}` }))).toBe(TxType.SWAP)
  })

  it('liquidity 0xe8e33700 → SWAP (eks LIQUIDITY)', () => {
    expect(classifyTransaction(makeTx({ input: `0xe8e33700${'55'.repeat(32)}` }))).toBe(TxType.SWAP)
  })

  it('NFT transfer 0x42842e0e → ERC20_TRANSFER (keluarga transfer)', () => {
    expect(classifyTransaction(makeTx({ input: `0x42842e0e${'66'.repeat(32)}` }))).toBe(
      TxType.ERC20_TRANSFER
    )
  })

  it('NFT mint 0x40c10f19 → SWAP (eks NFT_MINT)', () => {
    expect(classifyTransaction(makeTx({ input: `0x40c10f19${'77'.repeat(32)}` }))).toBe(TxType.SWAP)
  })

  it('multicall 0xac9650d8 → SWAP (eks CONTRACT_CALL eksplisit)', () => {
    expect(classifyTransaction(makeTx({ input: `0xac9650d8${'88'.repeat(32)}` }))).toBe(TxType.SWAP)
  })

  it('bridge deposit 0xd0e30db0 & withdraw 0x2e1a7d4d → BRIDGE (merge deposit+withdraw)', () => {
    expect(classifyTransaction(makeTx({ input: `0xd0e30db0${'99'.repeat(32)}` }))).toBe(TxType.BRIDGE)
    expect(classifyTransaction(makeTx({ input: `0x2e1a7d4d${'aa'.repeat(32)}` }))).toBe(TxType.BRIDGE)
  })
})

describe('classifyTransaction (Langkah 7) — edge cases', () => {
  it('selector uppercase dinormalisasi ke lowercase', () => {
    // extractSelector() memanggil .toLowerCase() sebelum lookup
    const uppercaseInput = `0xA9059CBB${'11'.repeat(32)}`
    expect(classifyTransaction(makeTx({ input: uppercaseInput }))).toBe(TxType.ERC20_TRANSFER)
  })

  it('input pendek "0x1234" (< 4 byte selector) → SWAP (fallback)', () => {
    // Panjang < 10 karakter → selector tidak bisa diekstrak → fallback (kini SWAP)
    expect(classifyTransaction(makeTx({ input: '0x1234' }))).toBe(TxType.SWAP)
  })

  it('input string kosong "" → NATIVE_TRANSFER', () => {
    expect(classifyTransaction(makeTx({ input: '' }))).toBe(TxType.NATIVE_TRANSFER)
  })

  it('to undefined saat runtime → diperlakukan seperti tx biasa (bukan deploy)', () => {
    // Defensif: `tx.to === null` tidak mencakup undefined — tidak boleh
    // salah diklasifikasi sebagai deploy (kini SWAP), dan tidak boleh crash.
    const tx = makeTx({ input: '0x' })
    ;(tx as { to?: string | null }).to = undefined
    expect(classifyTransaction(tx)).toBe(TxType.NATIVE_TRANSFER)

    const txWithCalldata = makeTx({ input: ERC20_TRANSFER_INPUT })
    ;(txWithCalldata as { to?: string | null }).to = undefined
    expect(classifyTransaction(txWithCalldata)).toBe(TxType.ERC20_TRANSFER)
  })
})
