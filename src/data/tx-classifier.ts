/**
 * 12 tipe transaksi. Const-object pattern (bukan `enum` TS) agar kompatibel
 * dengan `erasableSyntaxOnly` di tsconfig (TS 6).
 */
export const TxType = {
  NATIVE_TRANSFER: 'native_transfer',
  ERC20_TRANSFER: 'erc20_transfer',
  ERC20_APPROVE: 'erc20_approve',
  DEX_SWAP: 'dex_swap',
  LIQUIDITY: 'liquidity',
  BRIDGE_DEPOSIT: 'bridge_deposit',
  BRIDGE_WITHDRAW: 'bridge_withdraw',
  NFT_TRANSFER: 'nft_transfer',
  NFT_MINT: 'nft_mint',
  CONTRACT_DEPLOY: 'contract_deploy',
  CONTRACT_CALL: 'contract_call',
  RWA_TOKEN: 'rwa_token',
} as const

export type TxType = (typeof TxType)[keyof typeof TxType]

export const METHOD_SIGNATURES: Record<string, TxType> = {
  // ERC-20
  '0xa9059cbb': TxType.ERC20_TRANSFER,
  '0x095ea7b3': TxType.ERC20_APPROVE,
  '0x23b872dd': TxType.ERC20_TRANSFER,
  '0x39509351': TxType.ERC20_APPROVE, // increaseAllowance
  '0xa457c2d7': TxType.ERC20_APPROVE, // decreaseAllowance
  '0xd505accf': TxType.ERC20_APPROVE, // permit (Dai-style, dengan expiry)
  '0x6e291e48': TxType.ERC20_APPROVE, // permit (ERC-2612)
  '0xa22cb465': TxType.ERC20_APPROVE, // setApprovalForAll (ERC-721/1155)

  // DEX / Swap
  '0x38ed1739': TxType.DEX_SWAP,
  '0x7ff36ab5': TxType.DEX_SWAP,
  '0x18cbafe5': TxType.DEX_SWAP,
  '0xc04b8d59': TxType.DEX_SWAP,
  '0x414bf389': TxType.DEX_SWAP,
  '0x5ae401dc': TxType.DEX_SWAP,

  // Liquidity
  '0xe8e33700': TxType.LIQUIDITY,
  '0xf305d719': TxType.LIQUIDITY,
  '0xbaa2abde': TxType.LIQUIDITY,
  '0x02751cec': TxType.LIQUIDITY,

  // Bridge (deposit/withdraw WETH memakai semantik terdekat: wrap/unwrap)
  '0x439370b1': TxType.BRIDGE_DEPOSIT,
  '0xd2ce7d65': TxType.BRIDGE_DEPOSIT,
  '0xd0e30db0': TxType.BRIDGE_DEPOSIT, // deposit() — WETH
  '0x25e16063': TxType.BRIDGE_WITHDRAW,
  '0xc2eeeebd': TxType.BRIDGE_WITHDRAW,
  '0x2e1a7d4d': TxType.BRIDGE_WITHDRAW, // withdraw(uint256) — WETH

  // NFT
  '0x42842e0e': TxType.NFT_TRANSFER,
  '0x40c10f19': TxType.NFT_MINT,
  '0xa1448194': TxType.NFT_MINT,
  '0xf242432a': TxType.NFT_TRANSFER,
  '0x2eb2c2d6': TxType.NFT_TRANSFER, // safeBatchTransferFrom (ERC-1155)

  // Contract call umum (eksplisit meski fallback juga CONTRACT_CALL)
  '0xac9650d8': TxType.CONTRACT_CALL, // multicall(bytes[])
  '0x6a761202': TxType.CONTRACT_CALL, // execTransaction (Gnosis Safe)
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
    return TxType.CONTRACT_DEPLOY
  }

  if (!tx.input || tx.input === '0x') {
    return TxType.NATIVE_TRANSFER
  }

  const selector = extractSelector(tx.input)

  if (selector && METHOD_SIGNATURES[selector]) {
    return METHOD_SIGNATURES[selector]
  }

  return TxType.CONTRACT_CALL
}
