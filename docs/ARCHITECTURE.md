# Arsitektur GasHood

Dokumen ini menjelaskan arsitektur teknis proyek GasHood — 3D virtual gas fee tracker untuk Robinhood Chain L2 Mainnet.

---

## Overview

GasHood adalah single-page application (SPA) yang terdiri dari 3 layer utama:

```
┌─────────────────────────────────────────────────────┐
│                  Presentation Layer                  │
│  ┌──────────────────────┬────────────────────────┐  │
│  │    3D Scene (R3F)     │    2D Overlay (React)  │  │
│  │  - GasCity            │  - Dashboard           │  │
│  │  - GasBuilding ×12    │  - GasTable            │  │
│  │  - GasParticles       │  - TxFeed              │  │
│  │  - DataRiver          │  - Legend               │  │
│  │  - SkyDome            │  - Tooltip/Modal       │  │
│  └──────────────────────┴────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│                    State Layer                        │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Zustand Store (gas-store)           │ │
│  │  - gasMetrics: Map<TxType, GasMetric>           │ │
│  │  - recentTxs: Transaction[]                     │ │
│  │  - networkStats: { tps, avgGas, totalTx }       │ │
│  │  - uiState: { selected, hovered, timeRange }    │ │
│  └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                     Data Layer                       │
│  ┌──────────────┬──────────────┬───────────────────┐ │
│  │  rpc-client   │  blockscout  │  gas-collector    │ │
│  │  (viem)       │  -client     │  (orchestrator)   │ │
│  └──────┬───────┴──────┬───────┴─────────┬─────────┘ │
│         │              │                 │           │
│  ┌──────┴───────┐ ┌────┴──────┐  ┌───────┴────────┐ │
│  │ tx-classifier │ │ gas-math  │  │  format utils  │ │
│  └──────────────┘ └───────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────┘
         │                    │
    ┌────┴────┐         ┌────┴────────────────┐
    │ Robinhood│         │ Blockscout API v2   │
    │ RPC Node │         │ (enrichment/fallback)│
    └─────────┘         └─────────────────────┘
```

---

## Komponen Detail

### 1. Data Layer

#### `src/config/chain.ts`
Konfigurasi konstan untuk Robinhood Chain:
```typescript
// Isi:
export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com/",
  blockExplorer: "https://robinhoodchain.blockscout.com",
  blockscoutApi: "https://robinhoodchain.blockscout.com/api/v2",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockTime: 100, // ms
} as const;
```

#### `src/data/rpc-client.ts`
Client RPC menggunakan viem:
- `getLatestBlock()` — ambil block terbaru beserta transaksi
- `getTransactionReceipt(hash)` — ambil receipt (gasUsed, effectiveGasPrice)
- `getGasPrice()` — L2 gas price saat ini
- `batchGetReceipts(hashes[])` — batch call untuk efisiensi

#### `src/data/blockscout-client.ts`
Client REST untuk Blockscout API v2:
- `getRecentTransactions(limit)` — list transaksi terbaru
- `getTransactionSummary(hash)` — human-readable summary
- `getStats()` — statistik network
- `getTokenTransfers(hash)` — detail token transfer

#### `src/data/tx-classifier.ts`
Klasifikasi transaksi berdasarkan calldata:
```typescript
export enum TxType {
  NATIVE_TRANSFER = "native_transfer",
  ERC20_TRANSFER  = "erc20_transfer",
  ERC20_APPROVE   = "erc20_approve",
  DEX_SWAP        = "dex_swap",
  LIQUIDITY       = "liquidity",
  BRIDGE_DEPOSIT  = "bridge_deposit",
  BRIDGE_WITHDRAW = "bridge_withdraw",
  NFT_TRANSFER    = "nft_transfer",
  NFT_MINT        = "nft_mint",
  CONTRACT_DEPLOY = "contract_deploy",
  CONTRACT_CALL   = "contract_call",
  RWA_TOKEN       = "rwa_token",
}
```
Logika klasifikasi:
1. `to === null` → `CONTRACT_DEPLOY`
2. `data === "0x"` atau kosong → `NATIVE_TRANSFER`
3. Match 4-byte selector dari daftar known methods
4. Fallback → `CONTRACT_CALL`

#### `src/data/gas-collector.ts`
Orchestrator utama yang menjalankan polling loop:
1. Poll block terbaru setiap 2-5 detik
2. Ambil semua transaksi dalam block
3. Batch fetch receipt untuk gas data
4. Klasifikasi setiap transaksi
5. Hitung metrik per tipe (avg, min, max, count)
6. Push ke Zustand store

#### `src/utils/gas-math.ts`
Kalkulasi gas fee spesifik Arbitrum Nitro:
```typescript
// Total fee = gasUsed × effectiveGasPrice
// effectiveGasPrice sudah include L1 + L2 component pada Arbitrum
export function calculateTotalFee(gasUsed: bigint, effectiveGasPrice: bigint): bigint;
export function gweiToEth(gwei: number): number;
export function weiToGwei(wei: bigint): number;
export function formatGasPrice(wei: bigint): string;
```

---

### 2. State Layer

#### `src/store/gas-store.ts`
Zustand store dengan struktur:
```typescript
interface GasMetric {
  txType: TxType;
  avgGasUsed: number;
  avgGasPrice: number;      // in Gwei
  minGasPrice: number;
  maxGasPrice: number;
  totalTxCount: number;
  recentTxCount: number;    // dalam window terakhir
  totalFeeEth: number;
  trend: "up" | "down" | "stable";
}

interface GasStore {
  // Data
  gasMetrics: Map<TxType, GasMetric>;
  recentTxs: ClassifiedTransaction[];
  networkStats: {
    currentGasPrice: number;
    avgBlockGas: number;
    tps: number;
    totalTransactions: number;
    lastBlockNumber: number;
  };

  // UI State
  selectedType: TxType | null;
  hoveredType: TxType | null;
  timeRange: "1m" | "5m" | "15m" | "1h";

  // Actions
  updateMetrics: (data: ClassifiedTransaction[]) => void;
  selectType: (type: TxType | null) => void;
  hoverType: (type: TxType | null) => void;
}
```

---

### 3. Presentation Layer — 3D Scene

#### `src/scene/World.tsx`
Root scene setup:
- Ambient + directional lighting
- Environment map (city/sunset preset)
- Ground plane dengan grid
- Fog untuk depth
- Post-processing pipeline

#### `src/scene/GasCity.tsx`
Container yang me-layout bangunan dalam grid:
- 12 bangunan untuk 12 tipe transaksi
- Grid 4×3 atau circular layout
- Spacing dinamis berdasarkan viewport

#### `src/scene/GasBuilding.tsx`
Satu bangunan mewakili satu tipe transaksi:
- **Height** = `avgGasUsed` (normalized)
- **Width** = `recentTxCount` (normalized)
- **Color** = gradient berdasar `avgGasPrice` bracket
- **Emission** = intensity berdasar aktivitas
- Label floating di atas bangunan
- Animasi smooth saat data berubah (lerp)

#### `src/scene/GasParticles.tsx`
Sistem partikel menggunakan InstancedMesh:
- Partikel baru muncul setiap tx masuk
- Warna = tipe transaksi
- Ukuran = gas used transaksi
- Animasi naik lalu menghilang (lifetime ~3 detik)
- Max 500 instance untuk performa

#### `src/scene/SkyDome.tsx`
Hemisphere/dome yang merespons network load:
- Load rendah → biru cerah, awan tipis
- Load sedang → oranye, sunset
- Load tinggi → merah gelap, awan tebal
- Transisi smooth antara state

#### `src/scene/DataRiver.tsx`
Aliran visual di dasar kota:
- Custom shader material
- Kecepatan = TPS network
- Intensitas cahaya = volume transaksi
- Arah alir dari kiri ke kanan

#### `src/scene/CameraController.tsx`
Kontrol kamera:
- OrbitControls dari drei
- Auto-rotate saat idle
- Smooth transition saat klik bangunan
- Batas zoom min/max
- Reset ke posisi default

---

### 4. Presentation Layer — 2D Overlay

#### `src/ui/Dashboard.tsx`
Statistik ringkasan di atas canvas:
- Current gas price (Gwei)
- Average gas used
- TPS
- Total transactions tracked
- Network health indicator

#### `src/ui/GasTable.tsx`
Tabel sortable semua tipe transaksi:
- Kolom: Type, Avg Gas, Avg Price, Tx Count, Total Fee
- Sort by kolom mana saja
- Highlight row saat hover bangunan 3D (dan sebaliknya)

#### `src/ui/TxFeed.tsx`
Feed real-time transaksi terbaru:
- Scrollable list
- Setiap item: hash (truncated), tipe, gas used, fee
- Link ke Blockscout explorer
- Auto-scroll ke atas saat data baru

#### `src/ui/Legend.tsx`
Legenda warna dan simbol:
- Color scale: hijau → kuning → merah
- Ikon per tipe transaksi
- Ukuran partikel meaning

---

## Data Flow Cycle

```
   ┌─── Poll Block ───┐
   │                   │
   ▼                   │
[RPC Node]             │
   │                   │
   ▼                   │
[Batch Receipts]       │ Setiap
   │                   │ 2-5 detik
   ▼                   │
[Classify Tx]          │
   │                   │
   ▼                   │
[Update Zustand] ──────┘
   │
   ├──► [3D Scene reacts]
   │      - Building heights animate
   │      - Particles spawn
   │      - Sky color shifts
   │      - River speed changes
   │
   └──► [2D UI reacts]
          - Dashboard updates
          - Table re-sorts
          - Feed prepends
```

---

## Performance Budget

| Metrik | Target |
|---|---|
| FPS | ≥ 60 fps |
| First Contentful Paint | < 2 detik |
| Bundle Size (gzip) | < 500 KB |
| Memory | < 200 MB |
| Max 3D Objects | ~500 (instanced) |
| Polling Interval | 2-5 detik |
| Max Recent Txs | 200 (ring buffer) |

---

## Error Handling Strategy

1. **RPC Failure** → Retry 3× dengan exponential backoff, fallback ke Blockscout API
2. **Blockscout Failure** → Tetap jalan dari RPC saja, log warning
3. **Parse Error** → Klasifikasi sebagai `CONTRACT_CALL` (fallback)
4. **WebGL Error** → Tampilkan fallback 2D dashboard
5. **Rate Limit** → Adaptive polling interval (2s → 5s → 10s)
