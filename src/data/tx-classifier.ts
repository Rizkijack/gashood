export enum TxType {
  NATIVE_TRANSFER = "native_transfer",
  ERC20_TRANSFER = "erc20_transfer",
  ERC20_APPROVE = "erc20_approve",
  DEX_SWAP = "dex_swap",
  LIQUIDITY = "liquidity",
  BRIDGE_DEPOSIT = "bridge_deposit",
  BRIDGE_WITHDRAW = "bridge_withdraw",
  NFT_TRANSFER = "nft_transfer",
  NFT_MINT = "nft_mint",
  CONTRACT_DEPLOY = "contract_deploy",
  CONTRACT_CALL = "contract_call",
  RWA_TOKEN = "rwa_token",
}

export const METHOD_SIGNATURES: Record<string, TxType> = {
  // ERC-20
  '0xa9059cbb': TxType.ERC20_TRANSFER,
  '0x095ea7b3': TxType.ERC20_APPROVE,

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

  // Bridge
  '0x439370b1': TxType.BRIDGE_DEPOSIT,
  '0xd2ce7d65': TxType.BRIDGE_DEPOSIT,
  '0x25e16063': TxType.BRIDGE_WITHDRAW,
  '0xc2eeeebd': TxType.BRIDGE_WITHDRAW,

  // NFT
  '0x42842e0e': TxType.NFT_TRANSFER,
  '0x40c10f19': TxType.NFT_MINT,
  '0xa1448194': TxType.NFT_MINT,
  '0xf242432a': TxType.NFT_TRANSFER,
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

function isNftTransfer(tx: TransactionData, selector: string): boolean {
  if (selector === '0x23b872dd') {
    return false
  }
  return selector === '0x42842e0e' || selector === '0xf242432a'
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
    const txType = METHOD_SIGNATURES[selector]

    if (selector === '0x23b872dd') {
      return isNftTransfer(tx, selector) ? TxType.NFT_TRANSFER : TxType.ERC20_TRANSFER
    }

    if (isNftTransfer(tx, selector)) {
      return TxType.NFT_TRANSFER
    }

    return txType
  }

  return TxType.CONTRACT_CALL
}
