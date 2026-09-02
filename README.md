# GasHood 🏙️⛽

> 3D Virtual Gas Fee Tracker untuk Robinhood Chain L2 Mainnet

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Chain](https://img.shields.io/badge/chain-Robinhood%20L2-purple)
![Chain ID](https://img.shields.io/badge/chain%20ID-4663-blue)
![Build](https://img.shields.io/badge/build-passing-brightgreen)

GasHood memvisualisasikan gas fee real-time dari **semua tipe transaksi** di [Robinhood Chain](https://robinhood.com/chain) (Arbitrum Nitro L2, Chain ID 4663) dalam bentuk **kota 3D virtual interaktif**.

Setiap tipe transaksi direpresentasikan sebagai **bangunan** yang tinggi, warna, dan intensitasnya berubah secara dinamis mengikuti data gas fee aktual. Partikel beterbangan dari bangunan saat transaksi baru masuk, sungai data mengalir di tengah kota, dan langit berubah warna sesuai kondisi jaringan.

---

## Fitur

- **12 Tipe Transaksi** — Native transfer, ERC-20, swap, bridge, NFT, deploy, RWA
- **Dunia 3D "Gas City"** — Bangunan, partikel instanced, sungai data shader, langit dinamis
- **Real-time** — Polling block terbaru setiap 2-5 detik (adaptive interval)
- **Dashboard 2D Overlay** — Stats bar, tabel sortable, feed transaksi live
- **Detail Panel** — Klik bangunan/tabel untuk detail gas per tipe
- **Interaktif** — Orbit, zoom, hover glow, camera focus saat select
- **Responsif** — Desktop (side panel), tablet (bottom sheet), mobile (full overlay)
- **Post-Processing** — Bloom, vignette untuk visual cinematic
- **Error Resilient** — WebGL fallback, RPC retry, adaptive polling

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
git clone <repo-url>
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

# Polling interval in ms (default: 3000)
VITE_POLLING_INTERVAL=3000

# Max recent transactions in ring buffer (default: 200)
VITE_MAX_RECENT_TXS=200
```

---

## Project Structure

```
src/
├── config/
│   └── chain.ts              # Robinhood Chain config (ID, RPC, explorer)
├── data/
│   ├── rpc-client.ts         # Viem public client (getBlock, getReceipt, batchGet)
│   ├── blockscout-client.ts  # Blockscout REST API (stats, transactions, summary)
│   ├── tx-classifier.ts      # 12 TxType + 22 method signatures + classify()
│   └── gas-collector.ts      # Polling orchestrator (adaptive interval, retry)
├── store/
│   └── gas-store.ts          # Zustand (gasMetrics, recentTxs, networkStats, uiState)
├── scene/
│   ├── World.tsx             # Root scene (lighting, ground, fog, environment, postFX)
│   ├── GasCity.tsx           # Grid 4×3 layout, 12 buildings
│   ├── GasBuilding.tsx       # Reactif building (height=color=emissive from store)
│   ├── GasParticles.tsx      # InstancedMesh (max 500, per-type colors)
│   ├── DataRiver.tsx         # Custom GLSL shader (scrolling noise, TPS-driven)
│   ├── SkyDome.tsx           # Hemisphere gradient (4 states by utilization)
│   ├── CameraController.tsx  # OrbitControls (auto-rotate, damping)
│   ├── CameraFocus.tsx       # Smooth camera focus on selected building
│   └── layout.ts             # Shared building position calculations
├── ui/
│   ├── Dashboard.tsx         # Top stats bar (gas price, TPS, block, avg fee)
│   ├── GasTable.tsx          # Sortable table (12 rows, hover/click sync with 3D)
│   ├── TxFeed.tsx            # Live transaction feed (scrollable, max 50)
│   ├── Legend.tsx             # Color scale + type dots (collapsible)
│   ├── DetailPanel.tsx       # Slide-in panel (min/avg/max gas, recent txs)
│   └── tx-theme.ts           # Shared colors, labels, gas brackets
├── utils/
│   ├── gas-math.ts           # calculateTotalFee, weiToGwei, weiToEth
│   └── format.ts             # formatGasPrice, formatEth, formatTxHash, formatNumber
├── App.tsx                   # Root (Canvas, WebGL detection, error boundary, overlays)
├── main.tsx                  # Entry point
└── vite-env.d.ts             # Vite env type definitions
```

---

## Data Flow

```
Robinhood RPC → rpc-client → gas-collector → gas-store → 3D Scene + 2D Overlay
                    ↓
              tx-classifier (12 TxType)
```

1. **gas-collector** polls `eth_getBlockByNumber` every 2-5s
2. Batch fetches `eth_getTransactionReceipt` (max 20 per batch)
3. **tx-classifier** identifies each tx type via 4-byte selector
4. **gas-store** aggregates metrics (avg, min, max, count, trend)
5. **3D Scene** reacts: building heights animate, particles spawn, river speeds up, sky shifts
6. **2D Overlay** updates: dashboard stats, table re-sorts, feed prepends

---

## 3D Visual Mapping

| Data | 3D Property | Range |
|---|---|---|
| `avgGasUsed` | Building height | 0.5 — 8.0 units |
| `avgGasPrice` | Building color | Green → Yellow → Red |
| `recentTxCount` | Building emissive | 0.1 — 0.8 intensity |
| TPS | DataRiver speed | 0.5 — 3.5x |
| Network utilization | SkyDome gradient | Blue → Orange → Red |

---

## Building Commands

```bash
npm run dev          # Start dev server (localhost:5173)
npm run build        # TypeScript check + production build
npm run preview      # Preview production build
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode
```

---

## Performance Targets

| Metric | Target |
|---|---|
| FPS | ≥ 60 |
| Bundle size (gzip) | < 500 KB |
| Memory | < 200 MB |
| Max 3D objects | 500 (instanced) |
| Polling interval | 2-5s adaptive |

---

## Robinhood Chain

| | |
|---|---|
| **Network** | Robinhood Chain (Arbitrum Nitro L2) |
| **Chain ID** | 4663 |
| **RPC** | `https://rpc.mainnet.chain.robinhood.com/` |
| **Explorer** | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |
| **Gas Token** | ETH |
| **Mainnet** | Sejak 1 Juli 2026 |

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — Arsitektur teknis detail
- [Data Sources](docs/DATA_SOURCES.md) — API endpoints, RPC methods, method signatures
- [3D Design](docs/3D_DESIGN.md) — Konsep visual dunia 3D
- [Workflow](docs/WORKFLOW.md) — Alur kerja implementasi 5 fase

---

## License

MIT
