# GasHood 🏙️⛽

> 3D Virtual Gas Fee Tracker untuk Robinhood Chain L2 Mainnet

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![Chain](https://img.shields.io/badge/chain-Robinhood%20L2-purple)
![Chain ID](https://img.shields.io/badge/chain%20ID-4663-blue)

GasHood memvisualisasikan gas fee real-time dari **semua tipe transaksi** di [Robinhood Chain](https://robinhood.com/chain) (Arbitrum Nitro L2, Chain ID 4663) dalam bentuk **kota 3D virtual interaktif**.

Setiap tipe transaksi direpresentasikan sebagai **bangunan** yang tinggi, warna, dan intensitasnya berubah secara dinamis mengikuti data gas fee aktual. Partikel beterbangan dari bangunan saat transaksi baru masuk, sungai data mengalir di tengah kota, dan langit berubah warna sesuai kondisi jaringan.

---

## ✨ Fitur

- ⛽ **12 Tipe Transaksi** — Native transfer, ERC-20, swap, bridge, NFT, deploy, RWA, dan lainnya
- 🏙️ **Dunia 3D "Gas City"** — Bangunan, partikel, sungai data, langit dinamis
- 📡 **Real-time** — Polling block terbaru setiap 2-5 detik
- 📊 **Dashboard 2D Overlay** — Stats, tabel sortable, feed transaksi
- 🎮 **Interaktif** — Orbit, zoom, hover, klik bangunan untuk detail
- 📱 **Responsif** — Desktop, tablet, mobile

---

## 🛠 Tech Stack

| Layer | Teknologi |
|---|---|
| Framework | React 19 + TypeScript |
| 3D Engine | React Three Fiber + Three.js |
| State | Zustand |
| Blockchain | viem |
| Styling | Tailwind CSS v4 |
| Build | Vite |

---

## 🚀 Quick Start

```bash
# Clone
git clone <repo-url>
cd gashood

# Install
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your settings

# Run dev server
npm run dev
```

Buka `http://localhost:5173`

---

## ⚙️ Environment Variables

```env
VITE_RPC_URL=https://rpc.mainnet.chain.robinhood.com/
VITE_ALCHEMY_API_KEY=            # Opsional
VITE_BLOCKSCOUT_API_URL=https://robinhoodchain.blockscout.com/api/v2
VITE_POLLING_INTERVAL=3000       # ms
```

---

## 📁 Struktur Proyek

```
src/
├── config/        # Konfigurasi chain
├── data/          # RPC client, Blockscout client, collector, classifier
├── store/         # Zustand state management
├── scene/         # Komponen 3D (R3F)
├── ui/            # Komponen 2D overlay
└── utils/         # Kalkulasi gas, formatting
```

---

## 📖 Dokumentasi

- [Architecture](docs/ARCHITECTURE.md) — Arsitektur teknis detail
- [Data Sources](docs/DATA_SOURCES.md) — API endpoints, RPC methods, method signatures
- [3D Design](docs/3D_DESIGN.md) — Konsep visual dunia 3D
- [Workflow](docs/WORKFLOW.md) — Alur kerja implementasi 5 fase

---

## 🔗 Robinhood Chain

| | |
|---|---|
| **Network** | Robinhood Chain (Arbitrum Nitro L2) |
| **Chain ID** | 4663 |
| **RPC** | `https://rpc.mainnet.chain.robinhood.com/` |
| **Explorer** | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |
| **Gas Token** | ETH |
| **Mainnet** | Sejak 1 Juli 2026 |

---

## 📝 License

MIT
