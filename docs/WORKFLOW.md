# Alur Kerja Implementasi — GasHood

Dokumen ini berisi alur kerja detail per fase, checklist, dependency graph, dan kriteria selesai untuk setiap tahap.

---

## Timeline Overview

```
Minggu 1        Minggu 2        Minggu 3        Minggu 4        Minggu 5
━━━━━━━━        ━━━━━━━━        ━━━━━━━━        ━━━━━━━━        ━━━━━━━━
Foundation      3D Basic        Real-time       UI Overlay      Polish
┣━ Setup        ┣━ Scene        ┣━ Polling      ┣━ Dashboard    ┣━ PostFX
┣━ RPC Client   ┣━ Buildings    ┣━ Particles    ┣━ Table        ┣━ Sound
┣━ Blockscout   ┣━ Camera       ┣━ River        ┣━ Feed         ┣━ Loading
┣━ Classifier   ┣━ Connect      ┣━ Sky          ┣━ Legend       ┣━ Errors
┣━ Collector    ┃  Store→3D     ┣━ Animation    ┣━ Interaction  ┣━ README
┗━ Store        ┃               ┗━ Optimize     ┗━ Responsive   ┗━ Deploy
```

---

## Dependency Graph

```mermaid
graph LR
    subgraph "Fase 1 - Foundation"
        A1["chain.ts"] --> A2["rpc-client.ts"]
        A1 --> A3["blockscout-client.ts"]
        A2 --> A5["gas-collector.ts"]
        A3 --> A5
        A4["tx-classifier.ts"] --> A5
        A5 --> A6["gas-store.ts"]
        A7["gas-math.ts"]
        A8["format.ts"]
    end

    subgraph "Fase 2 - 3D Basic"
        A6 --> B1["World.tsx"]
        B1 --> B2["GasCity.tsx"]
        B2 --> B3["GasBuilding.tsx"]
        B1 --> B4["CameraController.tsx"]
        A6 --> B3
    end

    subgraph "Fase 3 - Real-time"
        B3 --> C1["Smooth Animation"]
        A5 --> C2["Polling Loop"]
        B2 --> C3["GasParticles.tsx"]
        B1 --> C4["DataRiver.tsx"]
        B1 --> C5["SkyDome.tsx"]
    end

    subgraph "Fase 4 - UI Overlay"
        A6 --> D1["Dashboard.tsx"]
        A6 --> D2["GasTable.tsx"]
        A6 --> D3["TxFeed.tsx"]
        D4["Legend.tsx"]
        B3 --> D5["Hover/Click Sync"]
        D1 --> D5
    end

    subgraph "Fase 5 - Polish"
        C3 --> E1["PostProcessing"]
        D5 --> E2["Loading Screen"]
        E3["Deploy"]
    end
```

---

## Fase 1 — Foundation (Minggu 1)

### Tujuan
Setup proyek, koneksi ke blockchain, klasifikasi transaksi, dan state management.

### Checklist

#### 1.1 Project Setup
- [x] Init proyek: `npm create vite@latest gashood -- --template react-ts`
- [x] Install dependencies:
  ```bash
  npm install three @react-three/fiber @react-three/drei @react-three/postprocessing
  npm install zustand viem
  npm install tailwindcss @tailwindcss/vite
  npm install -D @types/three vitest
  ```
- [x] Konfigurasi `vite.config.ts`
- [x] Konfigurasi `tsconfig.json` (strict mode, path aliases)
- [x] Konfigurasi Tailwind CSS v4
- [x] Buat `.env.local` dengan environment variables
- [x] Buat `.gitignore`

#### 1.2 Chain Configuration
- [x] Buat `src/config/chain.ts`
  - Chain ID, RPC URL, explorer URL
  - Type definitions untuk chain config
- [x] Verifikasi: import dan log config, pastikan values benar

#### 1.3 RPC Client
- [x] Buat `src/data/rpc-client.ts`
  - `createRpcClient()` — init viem public client
  - `getLatestBlock()` — fetch block terbaru + txs
  - `getTransactionReceipt(hash)` — fetch single receipt
  - `batchGetReceipts(hashes[])` — batch fetch (max 20)
  - `getGasPrice()` — current L2 gas price
- [x] **Test:** `rpc-client.test.ts`
  - Koneksi ke Robinhood RPC berhasil
  - Bisa ambil block terbaru
  - Receipt mengandung gasUsed dan effectiveGasPrice

#### 1.4 Blockscout Client
- [x] Buat `src/data/blockscout-client.ts`
  - `getStats()` — network statistics
  - `getRecentTransactions(limit)` — list tx terbaru
  - `getTransactionSummary(hash)` — human-readable summary
- [ ] **Test:** `blockscout-client.test.ts`
  - Fetch stats berhasil
  - Response shape sesuai type definition

> **Catatan:** unit test `blockscout-client.test.ts` belum dibuat — opsional, bisa menyusul. Client **belum ter-wire di runtime** (semua data datang dari RPC langsung); sengaja dibiarkan untuk fallback/enrichment di fase berikutnya.

#### 1.5 Transaction Classifier
- [x] Buat `src/data/tx-classifier.ts`
  - `TxType` enum (12 tipe)
  - `METHOD_SIGNATURES` map (4-byte → tipe)
  - `classifyTransaction(tx)` → TxType
  - Handle edge case: transferFrom (ERC-20 vs ERC-721)
- [x] **Test:** `tx-classifier.test.ts`
  - Native transfer (empty calldata)
  - ERC-20 transfer (0xa9059cbb)
  - Contract deploy (to = null)
  - DEX swap (0x38ed1739)
  - Unknown method → CONTRACT_CALL

#### 1.6 Gas Collector
- [x] Buat `src/data/gas-collector.ts`
  - `startCollecting(interval)` — mulai polling loop
  - `stopCollecting()` — hentikan
  - `processBlock(block)` — extract + classify + calculate
  - Error handling: retry, adaptive interval
- [x] **Test:** `gas-collector.test.ts`
  - Proses satu block → output array ClassifiedTransaction
  - Error handling tidak crash

#### 1.7 Zustand Store
- [x] Buat `src/store/gas-store.ts`
  - `GasMetric` interface
  - `GasStore` interface
  - `useGasStore` hook
  - Actions: updateMetrics, selectType, hoverType
  - Computed: gasMetricsArray (sorted), networkHealth
- [x] **Test:** `gas-store.test.ts`
  - Update metrics mengubah state
  - Ring buffer recentTxs max 200

#### 1.8 Utility Functions
- [x] Buat `src/utils/gas-math.ts`
  - `calculateTotalFee(gasUsed, effectiveGasPrice)`
  - `weiToGwei(wei)`, `weiToEth(wei)`, `gweiToEth(gwei)`
- [x] Buat `src/utils/format.ts`
  - `formatGasPrice(gwei)` — "0.05 Gwei"
  - `formatEth(eth)` — "0.000018 ETH"
  - `formatTxHash(hash)` — "0xab..cd"
  - `formatNumber(n)` — "180,000"
- [x] **Test:** unit tests untuk semua format functions

### Kriteria Selesai Fase 1
- ✅ `npm run dev` berjalan tanpa error
- ✅ Console log menampilkan block terbaru dari Robinhood RPC
- ✅ Transaksi terklasifikasi dengan benar (cek 10 tx manual)
- ✅ Zustand store terupdate setiap polling cycle
- ✅ Semua unit test pass

---

## Fase 2 — 3D World Basic (Minggu 2)

### Tujuan
Scene 3D dasar dengan bangunan statis yang terhubung ke Zustand store.

### Checklist

#### 2.1 Canvas Setup
- [x] Buat `src/App.tsx`
  - `<Canvas>` dari R3F dengan config:
    - `camera={{ position: [15, 12, 15], fov: 50 }}`
    - `dpr={[1, 2]}` — adaptive pixel ratio
    - `shadows`
  - Layout: Canvas full screen + UI overlay di atas
- [x] Verifikasi: browser menampilkan canvas kosong

#### 2.2 World Scene
- [x] Buat `src/scene/World.tsx`
  - Ambient light (intensity 0.4)
  - Directional light (intensity 0.8, position [10, 15, 5])
  - Ground plane: `<mesh rotation={[-π/2, 0, 0]}>`
    - `PlaneGeometry(30, 30)`
    - `MeshStandardMaterial` dengan grid texture/warna gelap
  - Fog: `<fog attach="fog" args={['#0a0a0f', 20, 50]} />`
  - Environment: `<Environment preset="city" />`
- [x] Verifikasi: scene gelap dengan ground plane dan lighting

#### 2.3 Gas City Layout
- [x] Buat `src/scene/GasCity.tsx`
  - Layout grid 4×3 dengan spacing
  - Posisi bangunan computed dari index
  - Map dari TxType → posisi grid
  - Render 12 `<GasBuilding>` children
- [x] Verifikasi: 12 box muncul di grid

#### 2.4 Gas Building
- [x] Buat `src/scene/GasBuilding.tsx`
  - Props: `txType`, `position`
  - Subscribe ke Zustand store untuk metric tipe ini
  - BoxGeometry dengan height dari avgGasUsed
  - Color dari gas price bracket
  - Floating `<Text>` label di atas bangunan
  - Hover handler: `onPointerOver/Out`
  - Click handler: `onClick`
- [x] Verifikasi: bangunan muncul dengan warna dan label

#### 2.5 Camera Controller
- [x] Buat `src/scene/CameraController.tsx`
  - `<OrbitControls>` dari drei
  - `autoRotate` saat idle (speed 0.3)
  - `enableDamping` untuk smooth
  - Min/max distance (5 — 40)
  - Max polar angle (π/2.5 — tidak bisa lihat dari bawah)
- [x] Verifikasi: bisa orbit, zoom, pan

#### 2.6 Connect Store → 3D
- [x] Wire up gas-collector → store → buildings
  - Mulai polling saat App mount
  - Buildings auto-update height & color
- [x] Verifikasi: bangunan berubah saat data baru masuk

### Kriteria Selesai Fase 2
- ✅ 12 bangunan tampil di grid dengan label
- ✅ Bangunan mempunyai warna sesuai gas price
- ✅ Kamera bisa di-orbit, zoom, pan
- ✅ Data dari RPC mengubah tinggi bangunan
- ✅ Tidak ada console error

---

## Fase 3 — Real-time Data Flow (Minggu 3)

### Tujuan
Animasi live, efek partikel, sungai data, dan langit dinamis.

### Checklist

#### 3.1 Smooth Building Animation
- [~] Implementasi reaktif di `GasBuilding.tsx` — height/color/emissive dari store sudah ada ✓
  - Height lerp (speed 0.05) — [~] ditunda: transisi masih instan per poll (2-5s)
  - Color lerp (speed 0.03) — [~] ditunda, warna langsung mengikuti bracket baru
  - Pulse effect: scale 1.05 ada saat hover/select; pulse per tx baru belum ada
- [~] Verifikasi transisi smooth — ditunda bersama lerp (perubahan terjadi per poll, bukan per frame)

#### 3.2 Polling Loop Refinement
- [x] Implementasi adaptive polling di `gas-collector.ts`
  - Base: 3 detik (VITE_POLLING_INTERVAL, clamp 1-10s)
  - Rate limited: backoff ke 10 detik (×2 per gagal, cap MAX_INTERVAL 10s)
  - Recovery: turun 500ms per sukses
  - Track block number — skip jika block sama
- [x] Verifikasi: tidak ada duplicate processing

#### 3.3 Gas Particles
- [x] Buat `src/scene/GasParticles.tsx`
  - InstancedMesh (max 500 instances)
  - Listen to store: saat tx baru masuk, spawn partikel
  - Per-partikel: position, velocity, life, size, color
  - useFrame loop: update posisi, fade out, recycle
  - Color per TxType (lihat 3D_DESIGN.md)
- [x] Verifikasi: partikel muncul dari bangunan saat ada tx baru

#### 3.4 Data River
- [x] Buat `src/scene/DataRiver.tsx`
  - Plane geometry di tengah layout
  - Custom ShaderMaterial:
    - Scrolling noise pattern
    - Speed dari TPS
    - Color dari gas price
    - Glow effect
  - Subscribe ke store untuk speed & color
- [x] Verifikasi: sungai mengalir, kecepatan berubah

#### 3.5 Sky Dome
- [x] Buat `src/scene/SkyDome.tsx`
  - SphereGeometry hemisphere
  - Gradient shader:
    - 4 state: rendah/sedang/tinggi/sangat tinggi
    - Lerp antar state berdasar network utilization
  - Cloud layer (opsional, bisa pakai sprite)
- [x] Verifikasi: langit berubah warna saat gas price berubah

#### 3.6 Performance Optimization
- [x] Praktik optimasi dipakai: partikel pakai InstancedMesh (max 500), `useMemo` untuk geometry/height/color di GasBuilding
- [~] Profile Chrome DevTools Performance tab — ditunda, butuh sesi manual (bukan gate rilis)
- [ ] Optimasi lanjutan jika perlu (React.memo, reduce particles, `frameloop="demand"`)
- [~] Verifikasi DevTools 60 FPS — ditunda bersama profiling manual

### Kriteria Selesai Fase 3
- ✅ Bangunan beranimasi smooth
- ✅ Partikel muncul saat transaksi baru
- ✅ Sungai data mengalir
- ✅ Langit berubah warna
- ✅ Stabil 60 FPS
- ✅ Tidak ada memory leak (cek heap snapshot)

---

## Fase 4 — UI Overlay (Minggu 4)

### Tujuan
Dashboard 2D overlay di atas canvas 3D, interaksi bi-directional.

### Checklist

#### 4.1 Dashboard Stats
- [x] Buat `src/ui/Dashboard.tsx`
  - Layout: fixed top bar atau floating cards
  - Isi:
    - ⛽ Current Gas Price: X Gwei
    - 📊 TPS: X tx/s
    - 📦 Block: #XXXXXX
    - 💰 Avg Fee: X ETH
  - Subscribe ke store, update real-time
  - Styling: semi-transparent background, blur
- [x] Verifikasi: stats tampil dan update

#### 4.2 Gas Fee Table
- [x] Buat `src/ui/GasTable.tsx`
  - Tabel 12 baris (semua tipe)
  - Kolom: Type | Avg Gas | Avg Price | Count | Total Fee
  - Sortable by kolom
  - Row hover → highlight bangunan 3D (via store)
  - Row click → select type → camera focus
  - Color dot per tipe (match partikel color)
- [x] Verifikasi: tabel sortable, hover sync dengan 3D

#### 4.3 Transaction Feed
- [x] Buat `src/ui/TxFeed.tsx`
  - Scrollable vertical list
  - Per item: hash (link), tipe badge, gas used, fee
  - Auto-scroll ke atas saat data baru
  - Max 50 item visible (virtualized jika perlu)
  - Link ke Blockscout: `https://robinhoodchain.blockscout.com/tx/{hash}`
- [x] Verifikasi: feed scroll lancar, link berfungsi

#### 4.4 Legend
- [x] Buat `src/ui/Legend.tsx`
  - Color scale gas price (gradient bar)
  - Warna per tipe (dots + label)
  - Arti ukuran partikel
  - Collapsible/toggle
- [x] Verifikasi: legenda tampil, bisa collapse

#### 4.5 Bidirectional Interaction
- [x] Hover bangunan 3D → highlight row di GasTable
- [x] Hover row di GasTable → glow bangunan 3D
- [x] Klik bangunan → buka detail panel + focus camera
- [x] Klik row → sama seperti klik bangunan
- [x] Verifikasi: semua interaksi bi-directional bekerja

#### 4.6 Responsive Layout
- [x] Desktop: 3D full + side panel kanan
- [x] Tablet: 3D full + bottom sheet
- [x] Mobile: 3D simplified + toggle overlay
- [x] Verifikasi: layout benar di 3 breakpoint

### Kriteria Selesai Fase 4
- ✅ Dashboard stats update real-time
- ✅ Tabel sortable dan sync dengan 3D
- ✅ Feed scrollable dengan link ke explorer
- ✅ Interaksi 3D↔2D bi-directional
- ✅ Responsive di desktop, tablet, mobile

---

## Fase 5 — Polish & Deploy (Minggu 5)

### Tujuan
Visual polish, error handling, dokumentasi, dan deployment.

### Checklist

#### 5.1 Post-Processing
- [x] Tambah `<EffectComposer>` di World.tsx
  - [x] Bloom (threshold 0.8, intensity 0.5)
  - [x] Vignette (offset 0.3, darkness 0.5)
  - [~] SSAO jika performa cukup — opsional, ditunda
- [~] Tone mapping ACESFilmic — tidak diset eksplisit (pakai default postprocessing)
- [x] Verifikasi: visual lebih cinematic

#### 5.2 Loading Screen
- [x] Buat loading screen dengan `useProgress` dari drei (`src/ui/LoadingScreen.tsx`)
  - Progress bar
  - Logo GasHood (⛽ + teks)
  - "Connecting to Robinhood Chain..."
- [x] Transisi smooth saat loading selesai (fade-out 500ms lalu unmount)
- [x] Verifikasi: loading screen tampil saat pertama buka (tidak flash saat sudah di-cache)

#### 5.3 Error Handling UI
- [x] RPC error → toast notification (store.error + dismiss ✕)
- [x] WebGL not supported → fallback: tabel-only mode
- [x] No transactions found → "Waiting for new blocks..."
- [x] Verifikasi: semua error case ditangani gracefully

#### 5.4 Sound Design (Opsional)
- [~] Ambient background hum (volume dari network activity) — ditunda
- [~] Subtle "ding" per transaksi besar (gas > threshold) — ditunda
- [~] Mute toggle di UI — ditunda
- [~] Verifikasi: suara tidak mengganggu, bisa di-mute — ditunda

> **Catatan:** seluruh 5.4 bersifat opsional dan sengaja ditunda — tidak menghalangi rilis.

#### 5.5 README & Documentation
- [x] Update `README.md` (deskripsi, tech stack, setup, env vars — sudah ada; + bagian "✅ Status Implementasi")
  - Screenshot/GIF: ditunda — tanpa screenshot palsu
  - Contributing guide: belum ada (opsional)
- [x] Review docs/ dan update jika ada perubahan
- [x] Verifikasi: README akurat

#### 5.6 Build & Deploy
- [x] `bun run build` — no error (tsc -b + vite build)
- [x] Test production build locally: `bun run preview` + GET `/` → 200
- [~] Deploy ke Vercel — butuh user (akses dashboard + set env vars + verify production URL)
- [x] Verifikasi: production build berfungsi (preview local)

### Kriteria Selesai Fase 5
- ✅ Visual polish: bloom, vignette, tone mapping
- ✅ Loading screen berfungsi
- ✅ Error handling graceful
- ✅ README lengkap
- ✅ Production build sukses
- ✅ Deploy live dan berfungsi

---

## Ringkasan Kriteria Sukses Keseluruhan

| # | Kriteria | Metrik |
|---|---|---|
| 1 | Data akurat | Gas fee di app = gas fee di Blockscout (selisih < 1%) |
| 2 | Real-time | Data delay < 10 detik dari block time |
| 3 | Klasifikasi benar | 12 tipe tx teridentifikasi, coverage > 90% |
| 4 | 3D visual | Bangunan, partikel, sungai, langit — semua reaktif |
| 5 | Performa | 60 FPS stabil di mid-range hardware |
| 6 | Interaktif | Hover, klik, navigasi kamera, tabel↔3D sync |
| 7 | Responsif | Berfungsi di desktop, tablet, mobile |
| 8 | Error resilient | Tidak crash saat RPC down / rate limited |
