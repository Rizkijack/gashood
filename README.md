# GasHood

> 3D Virtual Gas Fee Tracker untuk Robinhood Chain L2 Mainnet

![Status](https://img.shields.io/badge/status-production-brightgreen)
![Chain](https://img.shields.io/badge/chain-Robinhood%20L2-purple)
![Chain ID](https://img.shields.io/badge/chain%20ID-4663-blue)
![Build](https://img.shields.io/badge/build-passing-brightgreen)

GasHood memvisualisasikan gas fee real-time dari **12 tipe transaksi** di [Robinhood Chain](https://robinhood.com/chain) (Arbitrum Nitro L2, Chain ID 4663) dalam bentuk **kota 3D virtual interaktif**.

Setiap tipe transaksi direpresentasikan sebagai **bangunan** yang tinggi, warna, dan intensitasnya berubah secara dinamis mengikuti data gas fee aktual. Partikel beterbangan dari bangunan saat transaksi baru masuk, sungai data mengalir di tengah kota, langit berubah warna sesuai kondisi jaringan, dan lalu lintas mobil mengikuti aktivitas blockchain.

**Live:** https://gashood.vercel.app

---

## Status Implementasi

| Fase | Status |
|---|---|
| Fase 1 — Foundation (config, RPC, Blockscout, classifier, collector, store) | Selesai |
| Fase 2 — 3D World Basic (World, GasCity, GasBuilding, CameraController) | Selesai |
| Fase 3 — Real-time Data Flow (animasi, partikel, river, sky) | Selesai |
| Fase 4 — UI Overlay (dashboard, tabel, feed, legend, interaksi, responsif) | Selesai |
| Fase 5 — Polish (PostFX, loading, error UI, docs, Vegetation, Traffic, RoadNetwork) | Selesai |

**Test: 122 passing** via [Vitest](https://vitest.dev) — unit + integration untuk RPC client, classifier, collector, store, scene layout, dan utils.

```bash
npm run test
```

---

## Fitur

- **12 Tipe Transaksi** — Native Transfer, ERC-20 Transfer, ERC-20 Approve, DEX Swap, Liquidity, Bridge Deposit, Bridge Withdraw, NFT Transfer, NFT Mint, Contract Deploy, Contract Call, RWA Token
- **Dunia 3D "Gas City"** — 12 bangunan dengan fasad prosedural, 220 pohon, sungai data shader, langit dinamis
- **Lalu Lintas Mobil** — 104 mobil instanced (ring avenue, jalan raya, jalan tol, viaduct), kepadatan mengikuti `network_utilization_percentage` Blockscout
- **Jaringan Jalan** — Ring avenue, 3 jalan lurus, highway keliling (3 lajur), viaduct tol, jembatan sungai, lampu jalan, zebra cross
- **Real-time** — Polling block terbaru setiap 2-10 detik (adaptive interval)
- **Dashboard 2D Overlay** — Stats bar, tabel sortable, feed transaksi live, grafik 24 jam
- **Detail Panel** — Klik bangunan/tabel untuk detail gas per tipe
- **Interaktif** — Orbit, zoom, hover glow, camera focus saat select
- **Responsif** — Desktop (side panel), tablet (bottom sheet), mobile (full overlay)
- **Post-Processing** — Bloom, Vignette, SSAO (desktop), film grain
- **Error Resilient** — WebGL fallback, RPC retry, adaptive polling, environment boundary

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| Framework | React 19 + TypeScript |
| 3D Engine | React Three Fiber + Three.js |
| Post-Processing | @react-three/postprocessing |
| State | Zustand |
| Blockchain | viem |
| Build | Vite |
| Language | TypeScript 6 (strict, erasableSyntaxOnly) |

---

## Quick Start

```bash
# Clone
git clone https://github.com/Rizkijack/gashood.git
cd gashood

# Install
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local (see Environment Variables below)

# Run dev server
npm run dev
```

Buka `http://localhost:5173`

---

## Environment Variables

```env
# Robinhood Chain RPC (required)
VITE_RPC_URL=https://rpc.mainnet.chain.robinhood.com/

# Blockscout API (required)
VITE_BLOCKSCOUT_API_URL=https://robinhoodchain.blockscout.com/api/v2

# Polling interval in ms (default: 3000, range: 1000-10000)
VITE_POLLING_INTERVAL=3000

# Max recent transactions in ring buffer (default: 200)
VITE_MAX_RECENT_TXS=200

# Snapshot URL riwayat 24 jam (optional — default: raw GitHub main)
VITE_SNAPSHOT_URL=https://raw.githubusercontent.com/Rizkijack/gashood/main/data/snapshots.json
```

---

## Project Structure

```
src/
├── config/
│   └── chain.ts              # Robinhood Chain config (ID 4663, RPC, Blockscout)
├── data/
│   ├── rpc-client.ts         # Viem public client (getBlock, batchGetReceipts, getGasPrice)
│   ├── blockscout-client.ts  # Blockscout REST API (stats, transactions, utilization)
│   ├── tx-classifier.ts      # 12 TxType enum + 22 method signatures + classifyTransaction()
│   ├── gas-collector.ts      # Polling orchestrator (adaptive 2-10s, race-condition guard)
│   ├── snapshot-aggregate.ts # Modul murni snapshot 24 jam (aggregate, merge)
│   └── history-client.ts     # Fetch + parse data/snapshots.json (fail-open)
├── store/
│   └── gas-store.ts          # Zustand (gasMetrics, recentTxs, networkStats, trafficDensity)
├── scene/
│   ├── World.tsx             # Root scene (lighting, ground textures, fog, environment, postFX)
│   ├── GasCity.tsx           # Grid 4×3 layout, 12 buildings
│   ├── GasBuilding.tsx       # Reactive building (height=gasPrice, color=bracket interpolation)
│   ├── BuildingFacade.tsx    # Procedural textures (glass/concrete), podium, rooftop details
│   ├── GasParticles.tsx      # InstancedMesh (max 500, per-type colors, ring-buffer spawn)
│   ├── DataRiver.tsx         # Custom GLSL shader (FBM noise, fresnel, caustics)
│   ├── SkyDome.tsx           # Hemisphere gradient (utilization-based, 5 states)
│   ├── CameraController.tsx  # OrbitControls (auto-rotate, damping)
│   ├── CameraFocus.tsx       # Smooth camera focus on selected building
│   ├── Vegetation.tsx        # 220 trees (3 types, 3-layer canopy) + 800 grass blades
│   ├── RoadNetwork.tsx       # Ring avenue, highways, bridges, street lamps, markings
│   ├── Traffic.tsx           # 104 cars (6 paths), density from Blockscout utilization
│   ├── layout.ts             # Shared layout (buildingHeight, positions, CITY_SCALE)
│   └── particle-spawn.ts     # Pure selectNewTxs() for ring-buffer saturation fix
├── ui/
│   ├── Dashboard.tsx         # Top stats bar (gas price, TPS, block, avg fee, ETH price)
│   ├── GasTable.tsx          # Sortable table (12 rows, hover/click sync with 3D)
│   ├── TxFeed.tsx            # Live transaction feed (scrollable, max 50)
│   ├── Legend.tsx             # Color scale + type dots (collapsible)
│   ├── LoadingScreen.tsx     # Loading screen (give-up 15s)
│   ├── ErrorToast.tsx        # Error RPC toast (generic, no internal details leak)
│   ├── DetailPanel.tsx       # Slide-in panel (min/avg/max gas, recent txs)
│   ├── GasHistoryChart.tsx   # Grafik gas 24 jam (SVG, label WIB)
│   └── tx-theme.ts           # Shared colors, labels, gas brackets (GAS_BRACKETS)
├── utils/
│   ├── gas-math.ts           # calculateTotalFee, weiToGwei, weiToEth
│   └── format.ts             # formatGasPrice, formatEth, formatTxHash, formatNumber
├── App.tsx                   # Root (lazy SceneCanvas, WebGL detection, error boundary, overlays)
├── main.tsx                  # Entry point (StrictMode)
└── vite-env.d.ts             # Vite env type definitions
```

---

## Data Flow

```
Robinhood RPC → rpc-client → gas-collector → gas-store → 3D Scene + 2D Overlay
                     ↓                                    ↓
               tx-classifier (12 TxType)         RoadNetwork + Traffic
                     ↓                           (density from Blockscout)
               Blockscout API v2
               (gas price, ETH price, utilization)
```

1. **gas-collector** polls `eth_getBlockByNumber` every 2-10s (adaptive)
2. Batch fetches `eth_getTransactionReceipt` (max 4 chunks concurrent, 20 per chunk)
3. **tx-classifier** identifies each tx type via 22 method signatures
4. **gas-store** aggregates metrics (avg, min, max, count, trend)
5. **Blockscout /stats** polls every 60s for gas price, ETH price, network utilization
6. **3D Scene** reacts: building heights animate, particles spawn, river flows, sky shifts, car density changes
7. **2D Overlay** updates: dashboard stats, table re-sorts, feed prepends, chart renders

---

## 3D Visual Mapping

| Data | 3D Property | Range |
|---|---|---|
| `avgGasPrice` (Gwei) | Building height | 7.5 — 150 units (1 Gwei = 50m) |
| `avgGasPrice` (Gwei) | Building color | Green → Yellow → Red (GAS_BRACKETS interpolation) |
| `recentTxCount` | Building width | 0.5 — 2.0 units |
| `recentTxCount` | Building emissive | 0.1 — 0.8 intensity |
| TPS | DataRiver speed | 0.3 — 1.3x |
| Network utilization | SkyDome gradient | 5 states (blue → red) |
| Network utilization | Car density | 16 — 104 cars (6 paths) |

---

## Building Commands

```bash
npm run dev          # Start dev server (localhost:5173)
npm run build        # TypeScript check + production build
npm run preview      # Preview production build
npm run test         # Run tests (122 tests)
npm run test:watch   # Run tests in watch mode
```

---

## Performance Targets

| Metric | Target | Actual |
|---|---|---|
| FPS | ≥ 60 | ~60 (desktop) |
| Bundle size (gzip) | < 500 KB | ~480 KB |
| Memory | < 200 MB | ~150 MB |
| Max 3D objects | 500 (instanced) | 104 cars + 500 particles + 220 trees |
| Polling interval | 2-10s adaptive | 2-10s |

---

## Robinhood Chain

| | |
|---|---|
| **Network** | Robinhood Chain (Arbitrum Nitro L2) |
| **Chain ID** | 4663 |
| **RPC** | `https://rpc.mainnet.chain.robinhood.com/` |
| **Explorer** | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |
| **Gas Token** | ETH |
| **Block Time** | 100ms |

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — Arsitektur teknis detail
- [Data Sources](docs/DATA_SOURCES.md) — API endpoints, RPC methods, method signatures
- [3D Design](docs/3D_DESIGN.md) — Konsep visual dunia 3D
- [Workflow](docs/WORKFLOW.md) — Alur kerja implementasi 5 fase

---

## License

MIT
