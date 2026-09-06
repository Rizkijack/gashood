# Arsitektur GasHood

Dokumen ini menjelaskan arsitektur teknis proyek GasHood — 3D virtual gas fee tracker untuk Robinhood Chain L2 Mainnet.

---

## Overview

GasHood adalah single-page application (SPA) yang terdiri dari 3 layer utama:

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  ┌──────────────────────────┬────────────────────────────┐  │
│  │    3D Scene (R3F)         │    2D Overlay (React)      │  │
│  │  - World (lighting, fog)  │  - Dashboard               │  │
│  │  - GasCity (12 buildings) │  - GasTable (12 rows)      │  │
│  │  - GasBuilding ×12        │  - TxFeed (live)           │  │
│  │  - BuildingFacade         │  - Legend (brackets)       │  │
│  │  - GasParticles (500)     │  - DetailPanel             │  │
│  │  - DataRiver (GLSL)       │  - GasHistoryChart (24h)   │  │
│  │  - SkyDome (5 states)     │  - ErrorToast              │  │
│  │  - Vegetation (220 trees) │  - LoadingScreen           │  │
│  │  - RoadNetwork (highway)  │                            │  │
│  │  - Traffic (104 cars)     │                            │  │
│  │  - CameraController       │                            │  │
│  └──────────────────────────┴────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                      State Layer                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Zustand Store (gas-store)                   │ │
│  │  - gasMetrics: Map<TxType, GasMetric> (12 types)        │ │
│  │  - recentTxs: ClassifiedTransaction[] (ring buffer 200) │ │
│  │  - networkStats: { currentGasPrice, tps, trafficDensity }│ │
│  │  - uiState: { selected, hovered, timeRange }             │ │
│  └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                       Data Layer                              │
│  ┌──────────────┬──────────────┬───────────────────────────┐ │
│  │  rpc-client   │  blockscout  │  gas-collector            │ │
│  │  (viem)       │  -client     │  (orchestrator)           │ │
│  └──────┬───────┴──────┬───────┴─────────┬─────────────────┘ │
│         │              │                 │                   │
│  ┌──────┴───────┐ ┌────┴──────┐  ┌───────┴────────┐         │
│  │ tx-classifier │ │ gas-math  │  │  format utils  │         │
│  │ (12 TxType)   │ │           │  │                │         │
│  └──────────────┘ └───────────┘  └────────────────┘         │
└─────────────────────────────────────────────────────────────┘
         │                    │
    ┌────┴────┐         ┌────┴────────────────────┐
    │ Robinhood│         │ Blockscout API v2        │
    │ RPC Node │         │ (gas price, ETH price,   │
    └─────────┘         │  utilization, tx history) │
                        └──────────────────────────┘
```

---

## Komponen Detail

### 1. Data Layer

#### `src/config/chain.ts`
Konfigurasi konstan untuk Robinhood Chain:
```typescript
export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: "Robinhood Chain",
  rpcUrl: import.meta.env.VITE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/",
  blockExplorer: "https://robinhoodchain.blockscout.com",
  blockscoutApi: import.meta.env.VITE_BLOCKSCOUT_API_URL || "https://robinhoodchain.blockscout.com/api/v2",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockTime: 100, // ms
} as const;
```

#### `src/data/rpc-client.ts`
Client RPC menggunakan viem:
- `getLatestBlock()` — ambil block terbaru beserta transaksi
- `getLatestBlockNumber()` — ambil nomor block terbaru
- `getTransactionReceipt(hash)` — ambil receipt (gasUsed, effectiveGasPrice)
- `getGasPrice()` — L2 gas price saat ini
- `batchGetReceipts(hashes[])` — batch call dengan worker pool (4 concurrent chunks × 20 per chunk)

#### `src/data/blockscout-client.ts`
Client REST untuk Blockscout API v2:
- `getStats()` — statistik network (total blocks, addresses, transactions, gas prices, utilization)
- `getRecentTransactions(limit)` — list transaksi terbaru
- `getTransactionSummary(hash)` — human-readable summary
- `getRecentTxCount(minutes)` — estimasi transaksi per menit

#### `src/data/tx-classifier.ts`
Klasifikasi transaksi berdasarkan 22 method signatures:
```typescript
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
```

Logika klasifikasi:
1. `to === null` → `CONTRACT_DEPLOY`
2. `data === "0x"` atau kosong → `NATIVE_TRANSFER`
3. Match 4-byte selector dari daftar known methods
4. Fallback → `CONTRACT_CALL`

#### `src/data/gas-collector.ts`
Orchestrator utama yang menjalankan polling loop:
1. Poll block terbaru setiap 2-10 detik (adaptive interval)
2. Dedup block (skip jika sama)
3. Batch fetch receipt untuk gas data
4. Klasifikasi setiap transaksi
5. Hitung metrik per tipe (avg, min, max, count, trend)
6. Push ke Zustand store
7. Refresh Blockscout /stats setiap 60 detik (gas price, ETH price, utilization)

**Race condition protection:** `runId` token + `isRunning` flag mencegah double-loop di React StrictMode.

**Adaptive polling:** Default 3s, exponential backoff ke 10s saat gagal, recovery -500ms saat sukses.

#### `src/utils/gas-math.ts`
Kalkulasi gas fee spesifik Arbitrum Nitro:
```typescript
export function calculateTotalFee(gasUsed: bigint, effectiveGasPrice: bigint): bigint;
export function gweiToEth(gwei: number): number;
export function weiToGwei(wei: bigint): number;
export function weiToEth(wei: bigint): number;
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

interface NetworkStats {
  currentGasPrice: number;
  avgBlockGas: number;
  tps: number;
  totalTransactions: number;
  lastBlockNumber: number;
  ethUsdPrice: number | null;
  trafficDensity: number;  // 0-100, dari Blockscout utilization
}

interface GasStore {
  gasMetrics: Map<TxType, GasMetric>;
  recentTxs: ClassifiedTransaction[];
  networkStats: NetworkStats;
  selectedType: TxType | null;
  hoveredType: TxType | null;
  timeRange: "1m" | "5m" | "15m" | "1h";
  isCollecting: boolean;
  error: string | null;
  consecutiveFailures: number;
  blockscoutGasPrice: number | null;

  updateMetrics: (txs, blockNumber, currentGasPriceWei?) => void;
  setTrafficDensity: (density: number) => void;
  setBlockscoutGasPrice: (gwei: number | null) => void;
  seedFromSnapshot: (snapshot: GasSnapshot) => void;
  // ... other actions
}
```

---

### 3. Presentation Layer — 3D Scene

#### `src/scene/World.tsx`
Root scene setup:
- Ambient + hemisphere + directional + point lights
- Procedural ground textures (grass, plaza, sidewalk, road) via CanvasTexture
- Environment map (city preset)
- Fog untuk depth
- Post-processing pipeline (Bloom, Vignette, SSAO desktop-only, film grain)
- Responsive: DataRiver & SSAO hidden di viewport < 768px

#### `src/scene/GasCity.tsx`
Container yang me-layout 12 bangunan dalam grid 4×3:
- Baris z ∈ {-60, 0, 60}, kolom x ∈ {-90, -30, 30, 90}
- Spacing = 4 × CITY_SCALE (60 units)

#### `src/scene/GasBuilding.tsx`
Satu bangunan mewakili satu tipe transaksi:
- **Height** = `avgGasPrice` × (50/4.5) → 1 Gwei = 50m, clamp 7.5–150
- **Width** = `recentTxCount` normalized
- **Color** = smooth interpolation dari GAS_BRACKETS (green → red)
- **Emission** = intensity berdasar aktivitas + pulse effect
- Podium lobby + cap atap/parapet
- Floating labels (Billboard + drei Text)

#### `src/scene/BuildingFacade.tsx`
Arsitektur prosedural:
- 2 arketipe: Glass (kaca modern) dan Concrete (beton mid-rise)
- Tekstur albedo + emissiveMap + roughnessMap via CanvasTexture
- Geometri tower: merge stack setback (3 layers)
- Podium: batu gelap + pita kaca pintu masuk
- RooftopDetails: AC, antena, water tower (InstancedMesh global)

#### `src/scene/GasParticles.tsx`
Sistem partikel menggunakan InstancedMesh:
- Max 500 instance (200 di mobile)
- Per-type colors (12 warna)
- Ring-buffer spawn dari `selectNewTxs()` (tahan ring buffer penuh)
- Idle path: skip loop + upload matrix saat 0 active particles

#### `src/scene/SkyDome.tsx`
Hemisphere gradient yang merespons network load:
- 5 states berdasarkan `avgBlockGas / BLOCK_GAS_LIMIT`
- Lerp halus antar state
- Custom shader (vertex + fragment)

#### `src/scene/DataRiver.tsx`
Aliran visual di dasar kota:
- Custom GLSL shader (FBM 4-octave noise)
- Kecepatan = TPS (lambat, organik)
- Efek: specular, caustics, fresnel rim, shimmer
- 3 lapis: riverbed gelap → bank → permukaan air transparan

#### `src/scene/Vegetation.tsx`
220 pohon + 800 rumput:
- 3 tipe pohon (kerucut biasa, lebar, bundar)
- 3-layer canopy (bawah, atas, pucuk)
- Rejection sampling: avoids buildings, river, plaza, sidewalk
- Minimum spacing 1.8 × CITY_SCALE
- PRNG deterministik (mulberry32)

#### `src/scene/RoadNetwork.tsx`
Jaringan jalan:
- **Ring avenue** — 4 strip, lebar 1.6 (2 lajur)
- **3 jalan lurus** — di z = -SPACING/2, -SPACING, -1.5×SPACING
- **Highway keliling** — 4 strip, lebar 2.4 (3 lajur) di ±HIGHWAY_H
- **Viaduct tol** — dek y=6, pilar, gerbang tol
- **Jembatan** — dek segmen miring mengikuti ramp, pagar
- **Marka jalan** — garis tepi solid + tengah putus-putus
- **Zebra cross** — 4 buah (1 per sisi ring)
- **Lampu jalan** — 12 tiang + kepala (vertex color, 1 InstancedMesh)

#### `src/scene/Traffic.tsx`
104 mobil instanced (6 jalur):
- **Ring avenue** — 40 mobil (20 per arah)
- **3 jalan lurus** — 24 mobil (8 per arah)
- **Highway keliling** — 24 mobil (12 per arah)
- **Viaduct tol** — 16 mobil (8 per arah)
- **Kepadatan** — mengikuti `networkStats.trafficDensity` (0-100)
- **Transisi halus** — lerp 0.03/frame, mobil non-aktif scale 0
- **Kecepatan** — BASE_SPEED tetap (2.2 unit/s), tidak berubah

#### `src/scene/layout.ts`
Shared layout:
- `CITY_SCALE = 15` — tunggal sumber rescale kota
- `SPACING = 4 × CITY_SCALE` — grid pitch
- `RIVER_Z = SPACING / 2` — koridor sungai
- `buildingHeight(avgGasPriceGwei)` — 1 Gwei = 50m = 11.11 units

#### `src/scene/CameraController.tsx`
OrbitControls dari drei:
- Auto-rotate saat idle (0.3 rad/s)
- Damping (0.05)
- Batas zoom min/max
- Reset ke posisi default

---

### 4. Presentation Layer — 2D Overlay

#### `src/ui/Dashboard.tsx`
Statistik ringkasan di atas canvas:
- Current gas price (Gwei + USD)
- TPS
- Block number
- Average fee per tx (ETH + USD)
- Total transactions
- ETH price

#### `src/ui/GasTable.tsx`
Tabel sortable 12 tipe transaksi:
- Kolom: Type, Avg Gas, Avg Price, Tx Count
- Highlight row saat hover bangunan 3D (dan sebaliknya)
- Click untuk select → DetailPanel

#### `src/ui/TxFeed.tsx`
Feed real-time transaksi terbaru:
- Scrollable list (max 50)
- Setiap item: hash (truncated), tipe, gas used, fee
- Link ke Blockscout explorer

#### `src/ui/Legend.tsx`
Legenda warna dan simbol:
- Gas price gradient (GAS_BRACKETS)
- 12 warna tipe transaksi
- Collapsible

#### `src/ui/DetailPanel.tsx`
Slide-in panel saat bangunan/tabel diklik:
- Min/avg/max gas used
- Min/avg/max gas price
- Total fee (ETH)
- Tx count
- Recent transactions

#### `src/ui/GasHistoryChart.tsx`
Grafik gas 24 jam:
- SVG hand-rolled
- Data dari snapshot git-scraper (GitHub Actions)
- Label WIB (UTC+7)

---

## Data Flow Cycle

```
   ┌─── Poll Block (2-10s adaptive) ───┐
   │                                    │
   ▼                                    │
[RPC Node]                              │
   │                                    │
   ▼                                    │
[Batch Receipts]                        │
   │ (4 chunks × 20 per chunk)         │
   ▼                                    │
[Classify Tx]                           │
   │ (12 TxType, 22 signatures)        │
   ▼                                    │
[Update Zustand] ──────────────────────┘
   │
   ├──► [3D Scene reacts]
   │      - Building heights animate (gwei × 50m)
   │      - Building colors interpolate (GAS_BRACKETS)
   │      - Particles spawn from buildings
   │      - Sky color shifts (5 states)
   │      - River speed changes (TPS)
   │      - Car density changes (utilization)
   │
   └──► [2D UI reacts]
          - Dashboard updates
          - Table re-sorts
          - Feed prepends
          - Chart renders

   ┌─── Poll Blockscout /stats (60s) ──┐
   │                                    │
   ▼                                    │
[Blockscout API]                        │
   │                                    │
   ├──► gas_price.average → currentGasPrice
   ├──► coin_price → ethUsdPrice
   └──► network_utilization_percentage → trafficDensity
```

---

## Performance Budget

| Metrik | Target | Actual |
|---|---|---|
| FPS | ≥ 60 | ~60 |
| First Contentful Paint | < 2 detik | ~1.5s |
| Bundle Size (gzip) | < 500 KB | ~480 KB |
| Memory | < 200 MB | ~150 MB |
| Max 3D Objects | ~500 (instanced) | 104 cars + 500 particles + 220 trees |
| Polling Interval | 2-10 detik | adaptive |
| Max Recent Txs | 200 (ring buffer) | 200 |

---

## Error Handling Strategy

1. **RPC Failure** → Retry 3× dengan exponential backoff, fallback ke Blockscout API
2. **Blockscout Failure** → Tetap jalan dari RPC saja, log warning (non-fatal)
3. **Parse Error** → Klasifikasi sebagai `CONTRACT_CALL` (fallback)
4. **WebGL Error** → `SceneErrorBoundary` tampilkan fallback 2D dashboard
5. **Environment HDR Failed** → `EnvironmentBoundary` tampilkan null (scene tetap jalan)
6. **Rate Limit** → Adaptive polling interval (3s → 6s → 10s, recovery -500ms)
7. **Ring Buffer Full** → `selectNewTxs()` filter berdasarkan blockNumber
8. **Race Condition** → `runId` token cegah double-loop di StrictMode
