# Sumber Data GasHood

Dokumen ini merinci semua endpoint API, RPC method, contoh request/response, dan rate limits yang digunakan GasHood.

---

## 1. Robinhood Chain JSON-RPC

### Konfigurasi Koneksi

| Parameter | Nilai |
|---|---|
| **Public RPC** | `https://rpc.mainnet.chain.robinhood.com/` |
| **Alchemy RPC** | `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` |
| **Chain ID** | `4663` (`0x1237` hex) |
| **Protocol** | JSON-RPC 2.0 over HTTPS |
| **Rate Limit (public)** | ~25-50 req/detik (estimasi, bisa berubah) |
| **Rate Limit (Alchemy)** | Tergantung plan (Free: 330 CU/detik) |

### Method yang Digunakan

#### `eth_blockNumber`
Ambil nomor block terbaru.
```json
// Request
{
  "jsonrpc": "2.0",
  "method": "eth_blockNumber",
  "params": [],
  "id": 1
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x1a2b3c"  // block number in hex
}
```

#### `eth_getBlockByNumber`
Ambil block beserta transaksi.
```json
// Request
{
  "jsonrpc": "2.0",
  "method": "eth_getBlockByNumber",
  "params": ["latest", true],  // true = include full tx objects
  "id": 1
}

// Response (simplified)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "number": "0x1a2b3c",
    "timestamp": "0x66a3b4c5",
    "gasUsed": "0x7a120",
    "gasLimit": "0x1c9c380",
    "baseFeePerGas": "0x5f5e100",
    "transactions": [
      {
        "hash": "0xabc...",
        "from": "0x123...",
        "to": "0x456...",
        "value": "0xde0b6b3a7640000",
        "input": "0x",              // calldata
        "gas": "0x5208",
        "gasPrice": "0x5f5e100",
        "type": "0x2",              // EIP-1559
        "maxFeePerGas": "0x...",
        "maxPriorityFeePerGas": "0x..."
      }
      // ... more transactions
    ]
  }
}
```

**Field penting untuk GasHood:**
- `transactions[].input` → untuk klasifikasi tipe tx (4-byte selector)
- `transactions[].to` → null = contract deploy
- `transactions[].gas` → gas limit
- `baseFeePerGas` → L2 base fee

#### `eth_getTransactionReceipt`
Ambil receipt setelah tx dikonfirmasi.
```json
// Request
{
  "jsonrpc": "2.0",
  "method": "eth_getTransactionReceipt",
  "params": ["0xabc123..."],
  "id": 1
}

// Response (simplified)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "transactionHash": "0xabc123...",
    "gasUsed": "0x5208",              // 21000 untuk native transfer
    "effectiveGasPrice": "0x5f5e100", // total price (L1+L2 baked in)
    "status": "0x1",                  // 1 = success, 0 = revert
    "logs": [...]                     // event logs
  }
}
```

**Field penting:**
- `gasUsed` → gas aktual yang dipakai
- `effectiveGasPrice` → harga gas efektif (sudah include L1 data fee)
- `status` → sukses/gagal
- `gasUsed × effectiveGasPrice` = **total fee dalam wei**

#### `eth_gasPrice`
Gas price L2 saat ini.
```json
// Request
{ "jsonrpc": "2.0", "method": "eth_gasPrice", "params": [], "id": 1 }

// Response
{ "jsonrpc": "2.0", "id": 1, "result": "0x5f5e100" }  // in wei
```

#### Batch Request (Optimisasi)
Kirim beberapa call sekaligus:
```json
[
  { "jsonrpc": "2.0", "method": "eth_getTransactionReceipt", "params": ["0xhash1"], "id": 1 },
  { "jsonrpc": "2.0", "method": "eth_getTransactionReceipt", "params": ["0xhash2"], "id": 2 },
  { "jsonrpc": "2.0", "method": "eth_getTransactionReceipt", "params": ["0xhash3"], "id": 3 }
]
```
> Batch sampai 20 receipt per request untuk mengurangi round-trip.

---

## 2. Blockscout API v2

### Base Configuration

| Parameter | Nilai |
|---|---|
| **Base URL** | `https://robinhoodchain.blockscout.com/api/v2` |
| **API Docs** | `https://robinhoodchain.blockscout.com/api-docs` |
| **Auth** | API key (opsional untuk rate limit lebih tinggi) |
| **Format** | JSON |

### Endpoint yang Digunakan

#### `GET /stats`
Statistik jaringan.
```bash
curl https://robinhoodchain.blockscout.com/api/v2/stats
```
```json
{
  "total_blocks": "1234567",
  "total_addresses": "98765",
  "total_transactions": "5432100",
  "average_block_time": 0.1,
  "coin_price": "3450.00",
  "network_utilization_percentage": 15.2,
  "gas_prices": {
    "slow": 0.01,
    "average": 0.05,
    "fast": 0.1
  }
}
```

#### `GET /transactions`
List transaksi terbaru.
```bash
curl "https://robinhoodchain.blockscout.com/api/v2/transactions?type=validated"
```
```json
{
  "items": [
    {
      "hash": "0xabc...",
      "type": 2,
      "from": { "hash": "0x123..." },
      "to": { "hash": "0x456..." },
      "value": "1000000000000000000",
      "gas_used": "21000",
      "gas_price": "100000000",
      "fee": { "type": "actual", "value": "2100000000000000" },
      "method": "transfer",
      "tx_types": ["token_transfer"],
      "status": "ok",
      "block": 1234567,
      "timestamp": "2026-08-15T12:00:00.000000Z"
    }
  ],
  "next_page_params": { "block_number": 1234566, "index": 0 }
}
```

#### `GET /transactions/{hash}`
Detail satu transaksi.
```bash
curl https://robinhoodchain.blockscout.com/api/v2/transactions/0xabc...
```

#### `GET /transactions/{hash}/summary`
Summary human-readable.
```bash
curl https://robinhoodchain.blockscout.com/api/v2/transactions/0xabc.../summary
```
```json
{
  "data": {
    "summaries": [
      {
        "summary_template": "Swapped {token_in_value} {token_in_symbol} for {token_out_value} {token_out_symbol} on Uniswap V3",
        "summary_template_variables": {
          "token_in_value": { "type": "currency", "value": "1.5" },
          "token_in_symbol": { "type": "string", "value": "ETH" },
          "token_out_value": { "type": "currency", "value": "5175.00" },
          "token_out_symbol": { "type": "string", "value": "USDC" }
        }
      }
    ]
  }
}
```

#### `GET /transactions/{hash}/token-transfers`
Token transfer dalam transaksi.
```bash
curl https://robinhoodchain.blockscout.com/api/v2/transactions/0xabc.../token-transfers
```

---

## 3. Known Method Signatures (4-byte Selectors)

Digunakan oleh `tx-classifier.ts` untuk identifikasi tipe transaksi:

### ERC-20
```
0xa9059cbb → transfer(address,uint256)
0x23b872dd → transferFrom(address,address,uint256)
0x095ea7b3 → approve(address,uint256)
```

### DEX / Swap (Uniswap-style)
```
0x38ed1739 → swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
0x7ff36ab5 → swapExactETHForTokens(uint256,address[],address,uint256)
0x18cbafe5 → swapExactTokensForETH(uint256,uint256,address[],address,uint256)
0xc04b8d59 → exactInput((bytes,address,uint256,uint256,uint256))
0x414bf389 → exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
0x5ae401dc → multicall(uint256,bytes[])
```

### Liquidity
```
0xe8e33700 → addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)
0xf305d719 → addLiquidityETH(address,uint256,uint256,uint256,address,uint256)
0xbaa2abde → removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)
0x02751cec → removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)
```

### Bridge (Arbitrum-style)
```
0x439370b1 → depositETH()
0xd2ce7d65 → outboundTransfer(address,address,uint256,uint256,uint256,bytes)
0x25e16063 → withdrawETH(uint256)
0xc2eeeebd → initiateWithdrawal(...)
```

### NFT (ERC-721 / ERC-1155)
```
0x42842e0e → safeTransferFrom(address,address,uint256)
0x23b872dd → transferFrom(address,address,uint256)  // shared with ERC-20
0x40c10f19 → mint(address,uint256)
0xa1448194 → safeMint(address,uint256)
0xf242432a → safeTransferFrom(address,address,uint256,uint256,bytes)  // ERC-1155
```

> **Catatan:** `0x23b872dd` (transferFrom) digunakan oleh ERC-20 dan ERC-721. Untuk membedakan, cek apakah `to` address adalah known NFT contract, atau periksa jumlah parameter / event logs.

---

## 4. Strategi Pengambilan Data

### Polling Loop

```
┌──────────────────────────────────────────────┐
│              GasCollector Loop                │
│                                              │
│  1. eth_blockNumber()                        │
│     → Cek ada block baru?                    │
│     → Jika tidak, skip                       │
│                                              │
│  2. eth_getBlockByNumber(N, true)            │
│     → Ambil block + semua tx                 │
│                                              │
│  3. Batch eth_getTransactionReceipt()        │
│     → Max 20 per batch                       │
│     → Ambil gasUsed + effectiveGasPrice      │
│                                              │
│  4. tx-classifier.classify(tx)               │
│     → Tentukan tipe per transaksi            │
│                                              │
│  5. gas-store.updateMetrics(results)         │
│     → Push ke Zustand                        │
│                                              │
│  6. Sleep 2-5 detik                          │
│     → Adaptive berdasar rate limit status    │
└──────────────────────────────────────────────┘
```

### Rate Limit Handling

```typescript
// Adaptive interval
const BASE_INTERVAL = 2000;    // 2 detik
const MAX_INTERVAL = 10000;    // 10 detik
let currentInterval = BASE_INTERVAL;

// Jika 429 (rate limit):
currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);

// Jika sukses berturut-turut:
currentInterval = Math.max(currentInterval - 500, BASE_INTERVAL);
```

### Fallback Strategy

```
Primary: RPC eth_getBlockByNumber
  └─ Fail? → Blockscout GET /transactions
                └─ Fail? → Retry 3× exponential backoff
                              └─ Fail? → Show cached data + warning
```

---

## 5. Kalkulasi Gas Fee

### Formula (Arbitrum Nitro)

Pada Arbitrum Nitro, `effectiveGasPrice` dalam receipt sudah mencakup komponen L1 + L2:

```
Total Fee (wei) = gasUsed × effectiveGasPrice
Total Fee (ETH) = Total Fee (wei) / 10^18
Total Fee (Gwei) = Total Fee (wei) / 10^9
```

### Konversi Unit

| Unit | Faktor |
|---|---|
| 1 ETH | = 10^18 wei |
| 1 Gwei | = 10^9 wei |
| 1 ETH | = 10^9 Gwei |

### Contoh Kalkulasi

```
Native Transfer:
  gasUsed = 21,000
  effectiveGasPrice = 100,000,000 wei (0.1 Gwei)
  Total Fee = 21,000 × 100,000,000 = 2,100,000,000,000 wei
            = 0.0000021 ETH
            = ~$0.0072 (at ETH=$3,450)

DEX Swap:
  gasUsed = 180,000
  effectiveGasPrice = 100,000,000 wei (0.1 Gwei)
  Total Fee = 180,000 × 100,000,000 = 18,000,000,000,000 wei
            = 0.000018 ETH
            = ~$0.062
```

---

## 6. Environment Variables

```env
# .env.local
VITE_RPC_URL=https://rpc.mainnet.chain.robinhood.com/
VITE_ALCHEMY_API_KEY=           # Opsional, untuk higher rate limit
VITE_BLOCKSCOUT_API_URL=https://robinhoodchain.blockscout.com/api/v2
VITE_BLOCKSCOUT_API_KEY=        # Opsional
VITE_POLLING_INTERVAL=3000      # ms, default 3 detik
VITE_MAX_RECENT_TXS=200         # max transaksi di ring buffer
```
