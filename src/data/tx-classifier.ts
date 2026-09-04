/**
 * 4 kategori transaksi (refactor 12 → 4 kategori). Const-object pattern
 * (bukan `enum` TS) agar kompatibel dengan `erasableSyntaxOnly` di tsconfig (TS 6).
 *
 * Penggabungan kategori lama → baru (tidak ada tx yang diabaikan — semua
 * dialihkan ke keluarga terdekat):
 * - ERC20_APPROVE, DEX_SWAP, LIQUIDITY, NFT_MINT, CONTRACT_DEPLOY,
 *   CONTRACT_CALL, RWA_TOKEN → SWAP (semua interaksi kontrak / aktivitas DeFi)
 * - NFT_TRANSFER → ERC20_TRANSFER (keluarga transfer token)
 * - BRIDGE_DEPOSIT + BRIDGE_WITHDRAW → BRIDGE (satu gedung, arah dua arah)
 */
export const TxType = {
  NATIVE_TRANSFER: 'native_transfer',
  ERC20_TRANSFER: 'erc20_transfer',
  SWAP: 'swap',
  BRIDGE: 'bridge',
} as const

export type TxType = (typeof TxType)[keyof typeof TxType]

/**
 * Peta 4-byte selector → kategori. Struktur dipertahankan (tidak ada
 * signature dihapus) — hanya TARGET mappingnya yang diubah mengikuti
 * penggabungan 12 → 4 kategori.
 */
export const METHOD_SIGNATURES: Record<string, TxType> = {
  // ERC-20 transfer → ERC20_TRANSFER (tetap)
  '0xa9059cbb': TxType.ERC20_TRANSFER,
  '0x23b872dd': TxType.ERC20_TRANSFER,

  // Approve (eks ERC20_APPROVE) → SWAP — pra-syarat eksekusi swap di DEX
  '0x095ea7b3': TxType.SWAP,
  '0x39509351': TxType.SWAP, // increaseAllowance
  '0xa457c2d7': TxType.SWAP, // decreaseAllowance
  '0xd505accf': TxType.SWAP, // permit (Dai-style, dengan expiry)
  '0x6e291e48': TxType.SWAP, // permit (ERC-2612)
  '0xa22cb465': TxType.SWAP, // setApprovalForAll (ERC-721/1155)

  // DEX / Swap → SWAP (gedung SWAP mewarisi peran eks DEX_SWAP)
  '0x38ed1739': TxType.SWAP,
  '0x7ff36ab5': TxType.SWAP,
  '0x18cbafe5': TxType.SWAP,
  '0xc04b8d59': TxType.SWAP,
  '0x414bf389': TxType.SWAP,
  '0x5ae401dc': TxType.SWAP,

  // Liquidity (kategori LIQUIDITY dihapus) → SWAP (keluarga DeFi DEX)
  '0xe8e33700': TxType.SWAP,
  '0xf305d719': TxType.SWAP,
  '0xbaa2abde': TxType.SWAP,
  '0x02751cec': TxType.SWAP,

  // Bridge — deposit + withdraw (eks BRIDGE_DEPOSIT/BRIDGE_WITHDRAW) digabung
  // jadi SATU kategori BRIDGE (deposit/withdraw WETH: wrap/unwrap)
  '0x439370b1': TxType.BRIDGE,
  '0xd2ce7d65': TxType.BRIDGE,
  '0xd0e30db0': TxType.BRIDGE, // deposit() — WETH
  '0x25e16063': TxType.BRIDGE,
  '0xc2eeeebd': TxType.BRIDGE,
  '0x2e1a7d4d': TxType.BRIDGE, // withdraw(uint256) — WETH

  // NFT transfer (kategori NFT_TRANSFER dihapus) → ERC20_TRANSFER (keluarga transfer)
  '0x42842e0e': TxType.ERC20_TRANSFER,
  '0xf242432a': TxType.ERC20_TRANSFER,
  '0x2eb2c2d6': TxType.ERC20_TRANSFER, // safeBatchTransferFrom (ERC-1155)

  // NFT mint (kategori NFT_MINT dihapus) → SWAP (interaksi kontrak)
  '0x40c10f19': TxType.SWAP,
  '0xa1448194': TxType.SWAP,

  // Contract call umum (kategori CONTRACT_CALL dihapus) → SWAP
  '0xac9650d8': TxType.SWAP, // multicall(bytes[])
  '0x6a761202': TxType.SWAP, // execTransaction (Gnosis Safe)
}

export interface TransactionData {
  hash: string
  from: string
  to: string | null
  input: string
  value: bigint
  gas: bigint
  gasPrice?: bigint
  type?: string
}

export interface ClassifiedTransaction extends TransactionData {
  txType: TxType
  gasUsed: bigint
  effectiveGasPrice: bigint
  fee: bigint
}

function extractSelector(data: string): string | null {
  if (!data || data === '0x' || data.length < 10) {
    return null
  }
  return data.slice(0, 10).toLowerCase()
}

export function classifyTransaction(tx: TransactionData): TxType {
  if (tx.to === null) {
    // Deploy kontrak (eks CONTRACT_DEPLOY) → SWAP
    return TxType.SWAP
  }

  if (!tx.input || tx.input === '0x') {
    return TxType.NATIVE_TRANSFER
  }

  const selector = extractSelector(tx.input)

  if (selector && METHOD_SIGNATURES[selector]) {
    return METHOD_SIGNATURES[selector]
  }

  // Fallback selector tak dikenal (eks CONTRACT_CALL) → SWAP
  return TxType.SWAP
}
