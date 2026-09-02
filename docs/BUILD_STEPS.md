# GasHood — Alur Tahapan Pembangunan

> Panduan langkah demi langkah dari nol sampai deploy, urut dan detail.
> Setiap langkah bergantung pada langkah sebelumnya — **jangan loncat**.

---

## Peta Tahapan

```
TAHAP 1          TAHAP 2          TAHAP 3          TAHAP 4          TAHAP 5
Pondasi          Koneksi          Dunia 3D         Nyawa             Wajah
Proyek           Blockchain       Dasar            Real-time         & Polish
                                                   
 1. Init         5. RPC           10. Canvas       16. Polling       23. Dashboard
 2. Deps         6. Receipts      11. Dunia        17. Animasi       24. Tabel
 3. Config       7. Klasifikasi   12. Bangunan     18. Partikel      25. Feed
 4. Types        8. Kolektor      13. Label        19. Sungai        26. Legend
                 9. Store         14. Kamera       20. Langit        27. Interaksi
                                  15. Wire         21. Pulse         28. Responsive
                                                   22. Performa      29. PostFX
                                                                     30. Loading
                                                                     31. Error
                                                                     32. Build
                                                                     33. Deploy
```

---

## TAHAP 1 — Pondasi Proyek

> _Tujuan: proyek bisa `npm run dev` dan menampilkan halaman kosong tanpa error._

---

### Langkah 1 — Inisialisasi Proyek Vite

**Apa:** Buat proyek React + TypeScript baru dengan Vite.

```bash
npm create vite@latest gashood -- --template react-ts
cd gashood
```

**Hasil:** Folder `gashood/` dengan `package.json`, `src/main.tsx`, `src/App.tsx` default.

**Verifikasi:**
```bash
npm install
npm run dev
# Browser buka http://localhost:5173 → tampil halaman Vite default
```

---

### Langkah 2 — Install Semua Dependencies

**Apa:** Pasang semua library yang dibutuhkan sekaligus.

```bash
# 3D Engine
npm install three @react-three/fiber @react-three/drei @react-three/postprocessing

# State management
npm install zustand

# Blockchain
npm install viem

# Styling
npm install tailwindcss @tailwindcss/vite

# Dev tools
npm install -D @types/three vitest
```

**Hasil:** `package.json` berisi semua dependency. `node_modules/` terisi.

**Verifikasi:**
```bash
npm run dev
# Tidak ada error saat start
```

---

### Langkah 3 — Konfigurasi Build Tools

**Apa:** Setup Vite, TypeScript, dan Tailwind agar siap pakai.

**File yang dibuat/diubah:**

1. **`vite.config.ts`** — tambah plugin Tailwind, set resolve alias `@/` → `src/`
2. **`tsconfig.json`** — strict mode, path alias `@/*`
3. **`src/index.css`** — import Tailwind: `@import "tailwindcss";`
4. **`.env.local`** — environment variables (RPC URL, polling interval)
5. **`.env.example`** — template env untuk dokumentasi
6. **`.gitignore`** — tambah `.env.local`, `node_modules`, `dist`

**Verifikasi:**
```bash
npm run dev
# Tailwind class berfungsi di App.tsx (coba <div className="text-red-500">Test</div>)
# Path alias berfungsi (coba import dari @/...)
```

---

### Langkah 4 — Definisi Tipe Data

**Apa:** Buat semua TypeScript types/interfaces yang akan dipakai seluruh proyek. Ini fondasi — semua file lain akan import dari sini.

**File:** `src/types/index.ts`

**Isi:**
```
TxType          — enum 12 tipe transaksi
RawTransaction  — data mentah dari RPC
TransactionReceipt — receipt dari RPC
ClassifiedTx    — transaksi yang sudah diklasifikasi + gas data
GasMetric       — metrik agregat per tipe (avg, min, max, count)
NetworkStats    — statistik network (tps, gasPrice, blockNumber)
```

**File:** `src/config/chain.ts`

**Isi:**
```
ROBINHOOD_CHAIN — objek konstan berisi:
  id: 4663
  name: "Robinhood Chain"
  rpcUrl, blockExplorer, blockscoutApi
  nativeCurrency, blockTime
```

**Verifikasi:**
```bash
# TypeScript compile tanpa error
npx tsc --noEmit
```

---

## TAHAP 2 — Koneksi Blockchain

> _Tujuan: console.log menampilkan data transaksi real dari Robinhood Chain, sudah diklasifikasi per tipe, dan tersimpan di Zustand store._

---

### Langkah 5 — RPC Client Dasar

**Apa:** Buat client yang bisa konek ke Robinhood RPC dan ambil block terbaru.

**File:** `src/data/rpc-client.ts`

**Fungsi yang dibuat:**
```
createClient()          → viem PublicClient untuk chain 4663
getLatestBlockNumber()  → nomor block terbaru (bigint)
getBlock(number)        → block + semua transaksi di dalamnya
getGasPrice()           → L2 gas price saat ini (bigint, wei)
```

**Bergantung pada:** Langkah 4 (`chain.ts`, types)

**Verifikasi:**
```typescript
// Di App.tsx sementara:
const block = await getBlock("latest");
console.log("Block:", block.number, "Txs:", block.transactions.length);
// Harus muncul nomor block dan jumlah tx > 0
```

**Test:** `src/data/__tests__/rpc-client.test.ts`
- Koneksi ke RPC berhasil
- Block number naik setiap beberapa detik
- Block berisi array transactions

---

### Langkah 6 — Batch Fetch Receipts

**Apa:** Ambil receipt (gasUsed, effectiveGasPrice) untuk banyak transaksi sekaligus.

**File:** `src/data/rpc-client.ts` (tambah fungsi)

**Fungsi yang ditambah:**
```
getTransactionReceipt(hash)   → receipt satu tx
batchGetReceipts(hashes[])    → receipt banyak tx (max 20 per batch)
```

**Bergantung pada:** Langkah 5

**Verifikasi:**
```typescript
const block = await getBlock("latest");
const hashes = block.transactions.map(tx => tx.hash);
const receipts = await batchGetReceipts(hashes);
console.log("Receipt pertama:", {
  gasUsed: receipts[0].gasUsed,           // misal 21000n
  effectiveGasPrice: receipts[0].effectiveGasPrice  // misal 100000000n
});
```

**Test:**
- Receipt punya field `gasUsed` dan `effectiveGasPrice`
- Batch 20 hash → 20 receipt kembali
- Hash tidak valid → handle error gracefully

---

### Langkah 7 — Klasifikasi Transaksi

**Apa:** Tentukan tipe setiap transaksi dari calldata-nya (4-byte method selector).

**File:** `src/data/tx-classifier.ts`

**Isi:**
```
METHOD_SIGNATURES   — Map<string, TxType> berisi 30+ known selectors
classifyTransaction(tx) → TxType

Logika urutan:
  1. tx.to === null                     → CONTRACT_DEPLOY
  2. tx.input === "0x" atau kosong      → NATIVE_TRANSFER
  3. Ambil 4 byte pertama dari tx.input
  4. Cocokkan dengan METHOD_SIGNATURES
  5. Tidak cocok                        → CONTRACT_CALL (fallback)
```

**File pendukung:** `src/utils/gas-math.ts`
```
calculateFee(gasUsed, effectiveGasPrice) → bigint (wei)
weiToGwei(wei)    → number
weiToEth(wei)     → number
```

**File pendukung:** `src/utils/format.ts`
```
formatGwei(gwei)      → "0.05 Gwei"
formatEth(eth)        → "0.000018 ETH"
formatTxHash(hash)    → "0xab..cd"
formatNumber(n)       → "180,000"
```

**Bergantung pada:** Langkah 4 (TxType enum, types)

**Verifikasi:**
```typescript
// Ambil block, klasifikasi setiap tx
const block = await getBlock("latest");
block.transactions.forEach(tx => {
  const type = classifyTransaction(tx);
  console.log(formatTxHash(tx.hash), "→", type);
});
// Output: 0xab..cd → dex_swap, 0xef..12 → native_transfer, dst
```

**Test:** `src/data/__tests__/tx-classifier.test.ts`
- Input "0x" → NATIVE_TRANSFER
- Input "0xa9059cbb..." → ERC20_TRANSFER
- Input "0x38ed1739..." → DEX_SWAP
- to === null → CONTRACT_DEPLOY
- Input tidak dikenal → CONTRACT_CALL

---

### Langkah 8 — Gas Collector (Orchestrator)

**Apa:** Gabungkan langkah 5-7 jadi satu mesin yang otomatis: ambil block → ambil receipts → klasifikasi → hitung metrik.

**File:** `src/data/gas-collector.ts`

**Fungsi:**
```
processBlock(blockNumber)
  1. getBlock(blockNumber)
  2. batchGetReceipts(semua hash)
  3. classifyTransaction(setiap tx)
  4. Gabungkan: tx + receipt + tipe → ClassifiedTx
  5. Return ClassifiedTx[]

aggregateMetrics(txs: ClassifiedTx[])
  Per TxType, hitung:
    avgGasUsed, avgGasPrice, minGasPrice, maxGasPrice
    totalTxCount, recentTxCount, totalFeeEth
    trend (up/down/stable vs window sebelumnya)
  Return Map<TxType, GasMetric>
```

**Bergantung pada:** Langkah 5, 6, 7

**Verifikasi:**
```typescript
const txs = await processBlock("latest");
const metrics = aggregateMetrics(txs);
console.table(
  Array.from(metrics.entries()).map(([type, m]) => ({
    type,
    avgGas: m.avgGasUsed,
    avgPrice: m.avgGasPrice.toFixed(4) + " Gwei",
    count: m.totalTxCount,
  }))
);
// Tabel muncul di console dengan data per tipe
```

**Test:** `src/data/__tests__/gas-collector.test.ts`
- processBlock mengembalikan array ClassifiedTx
- aggregateMetrics menghitung rata-rata dengan benar
- Block kosong (0 tx) → tidak crash, return map kosong

---

### Langkah 9 — Zustand Store

**Apa:** Tempat menyimpan semua data agar bisa diakses oleh komponen 3D dan UI.

**File:** `src/store/gas-store.ts`

**Isi:**
```
useGasStore = create<GasStore>(...)

State:
  gasMetrics:    Map<TxType, GasMetric>  — data per tipe
  recentTxs:     ClassifiedTx[]          — 200 tx terakhir (ring buffer)
  networkStats:  NetworkStats            — tps, gasPrice, blockNumber
  selectedType:  TxType | null           — bangunan yang di-klik
  hoveredType:   TxType | null           — bangunan yang di-hover
  isLoading:     boolean
  error:         string | null

Actions:
  updateFromBlock(txs, blockNumber)      — terima data baru, update semua
  selectType(type)                       — klik bangunan
  hoverType(type)                        — hover bangunan
  clearSelection()                       — reset
```

**Bergantung pada:** Langkah 4 (types), Langkah 8 (data shape)

**Verifikasi:**
```typescript
// Di App.tsx sementara:
useEffect(() => {
  const run = async () => {
    const txs = await processBlock("latest");
    useGasStore.getState().updateFromBlock(txs, 12345n);
    console.log("Store:", useGasStore.getState().gasMetrics);
  };
  run();
}, []);
// Console menampilkan Map dengan GasMetric per tipe
```

**Test:** `src/store/__tests__/gas-store.test.ts`
- updateFromBlock mengubah gasMetrics
- recentTxs max 200 (FIFO)
- selectType/hoverType mengubah state

---

## TAHAP 3 — Dunia 3D Dasar

> _Tujuan: browser menampilkan kota 3D dengan 12 bangunan berwarna, label, dan kamera yang bisa diputar. Data masih statis (dari 1x fetch saat mount)._

---

### Langkah 10 — Canvas 3D

**Apa:** Pasang React Three Fiber `<Canvas>` sebagai layar 3D utama.

**File:** `src/App.tsx` (tulis ulang)

**Isi:**
```tsx
<div className="w-screen h-screen bg-black">
  <Canvas
    camera={{ position: [15, 12, 15], fov: 50 }}
    dpr={[1, 2]}
    shadows
  >
    <World />
  </Canvas>
</div>
```

**Bergantung pada:** Langkah 2 (R3F installed), Langkah 3 (Tailwind configured)

**Verifikasi:**
```
Browser menampilkan canvas hitam tanpa error.
```

---

### Langkah 11 — Scene Dunia

**Apa:** Setup lighting, lantai, fog, dan environment map.

**File:** `src/scene/World.tsx`

**Isi:**
```
- <ambientLight intensity={0.4} />
- <directionalLight position={[10, 15, 5]} intensity={0.8} castShadow />
- Ground plane: PlaneGeometry(30, 30), warna gelap #1a1a2e
- <fog attach="fog" args={['#0a0a0f', 20, 50]} />
- <Environment preset="city" /> dari drei
- <GasCity /> (dibuat langkah 12)
- <CameraController /> (dibuat langkah 14)
```

**Bergantung pada:** Langkah 10

**Verifikasi:**
```
Canvas menampilkan lantai gelap dengan pencahayaan ambient.
Fog terlihat di kejauhan.
```

---

### Langkah 12 — Bangunan GasCity + GasBuilding

**Apa:** Render 12 bangunan (box) di grid 4×3, masing-masing mewakili 1 tipe transaksi.

**File:** `src/scene/GasCity.tsx`
```
- Definisi posisi grid 4×3 (x, z coordinates)
- Map setiap TxType ke posisi
- Render 12 <GasBuilding> dengan posisi masing-masing
```

**File:** `src/scene/GasBuilding.tsx`
```
Props: txType, position [x, y, z]

- Subscribe ke useGasStore → ambil GasMetric untuk txType ini
- <mesh position={...}>
    <boxGeometry args={[width, height, width]} />
    <meshStandardMaterial color={colorFromGasPrice} emissive={...} />
  </mesh>
- Height = normalize(avgGasUsed) → 0.5 sampai 8.0
- Color = bracket gas price → hijau/kuning/merah
- Width = normalize(txCount) → 0.5 sampai 2.0
```

**Bergantung pada:** Langkah 9 (store), Langkah 11 (World)

**Verifikasi:**
```
12 kotak warna-warni muncul di grid rapi di atas lantai.
Tinggi berbeda-beda sesuai data gas fee.
```

---

### Langkah 13 — Label Floating

**Apa:** Teks nama tipe dan stats ringkasan melayang di atas setiap bangunan.

**File:** `src/scene/GasBuilding.tsx` (tambah di dalam komponen)

**Isi:**
```tsx
<Text
  position={[0, height + 0.5, 0]}
  fontSize={0.3}
  color="white"
  anchorX="center"
  anchorY="bottom"
>
  {label}
  {`Avg: ${formatGwei(avgGasPrice)} Gwei`}
  {`Vol: ${txCount} tx`}
</Text>
```

Menggunakan `<Text>` dari `@react-three/drei` — otomatis billboard (selalu menghadap kamera).

**Bergantung pada:** Langkah 12

**Verifikasi:**
```
Setiap bangunan ada teks nama + angka di atasnya.
Teks selalu terbaca dari sudut mana pun.
```

---

### Langkah 14 — Kontrol Kamera

**Apa:** User bisa orbit, zoom, dan pan kota. Auto-rotate saat idle.

**File:** `src/scene/CameraController.tsx`

**Isi:**
```tsx
<OrbitControls
  autoRotate
  autoRotateSpeed={0.3}
  enableDamping
  dampingFactor={0.05}
  minDistance={5}
  maxDistance={40}
  maxPolarAngle={Math.PI / 2.5}
/>
```

**Bergantung pada:** Langkah 11 (World)

**Verifikasi:**
```
Drag kiri → orbit. Scroll → zoom. Drag kanan → pan.
Diam 3 detik → kota mulai berputar pelan.
```

---

### Langkah 15 — Wire Data → 3D

**Apa:** Hubungkan gas-collector ke store, dan pastikan store menggerakkan bangunan.

**File:** `src/App.tsx` (tambah logic)

**Isi:**
```typescript
useEffect(() => {
  // Fetch sekali saat mount
  const init = async () => {
    const txs = await processBlock("latest");
    useGasStore.getState().updateFromBlock(txs, blockNumber);
  };
  init();
}, []);
```

Saat ini belum polling loop — hanya 1x fetch saat halaman dibuka.

**Bergantung pada:** Langkah 8 (collector), Langkah 9 (store), Langkah 12 (buildings)

**Verifikasi:**
```
Buka halaman → bangunan muncul dengan tinggi & warna dari data real.
Refresh halaman → data bisa sedikit berbeda (block baru).
```

---

## TAHAP 4 — Nyawa Real-time

> _Tujuan: kota hidup — bangunan bergerak smooth, partikel berterbangan, sungai mengalir, langit berubah. Data update otomatis setiap 3 detik._

---

### Langkah 16 — Polling Loop

**Apa:** Dari 1x fetch jadi loop otomatis setiap 3 detik.

**File:** `src/hooks/useGasCollector.ts` (hook baru)

**Isi:**
```
useGasCollector()
  - Track lastBlockNumber
  - setInterval setiap POLLING_INTERVAL (3000ms)
  - Setiap tick:
      1. eth_blockNumber → ada block baru?
      2. Jika ya: processBlock → updateFromBlock
      3. Jika tidak: skip
  - Adaptive interval: rate limited → backoff, sukses → recover
  - Cleanup: clearInterval saat unmount
```

**File:** `src/App.tsx` — panggil `useGasCollector()`

**Bergantung pada:** Langkah 8 (collector), Langkah 9 (store)

**Verifikasi:**
```
Console: "Block 1234567: 15 txs" → 3 detik → "Block 1234568: 8 txs" → ...
Store ter-update otomatis setiap cycle.
```

---

### Langkah 17 — Animasi Smooth Bangunan

**Apa:** Bangunan berubah tinggi/warna secara smooth (lerp), bukan loncat instant.

**File:** `src/scene/GasBuilding.tsx` (modifikasi)

**Tambah:**
```typescript
useFrame(() => {
  // Lerp height
  const currentScale = meshRef.current.scale.y;
  const targetScale = normalizeHeight(avgGasUsed);
  meshRef.current.scale.y = THREE.MathUtils.lerp(currentScale, targetScale, 0.05);

  // Lerp color
  currentColor.lerp(targetColor, 0.03);
  materialRef.current.color.copy(currentColor);

  // Reposisi Y agar bangunan "tumbuh dari lantai"
  meshRef.current.position.y = meshRef.current.scale.y / 2;
});
```

**Bergantung pada:** Langkah 12 (GasBuilding), Langkah 16 (data terus update)

**Verifikasi:**
```
Bangunan naik/turun secara smooth saat data berubah.
Warna berubah gradual, bukan jump.
```

---

### Langkah 18 — Sistem Partikel

**Apa:** Setiap transaksi baru = 1 partikel muncul dari atas bangunan terkait.

**File:** `src/scene/GasParticles.tsx`

**Isi:**
```
MAX_PARTICLES = 500
InstancedMesh dengan SphereGeometry kecil

Data per partikel:
  position, velocity, life, maxLife, size, colorIndex

Listen ke store.recentTxs:
  Saat ada tx baru → spawn partikel di posisi bangunan tipe-nya

useFrame loop:
  Setiap frame, per partikel:
    life -= delta
    position.y += velocity.y * delta (naik)
    position.x += velocity.x * delta (drift)
    scale = size * (life / maxLife)  → mengecil
    Jika life <= 0 → recycle (reset ke pool)

  Update instanceMatrix
```

**Render di `World.tsx`:** `<GasParticles />`

**Bergantung pada:** Langkah 12 (posisi bangunan), Langkah 16 (data baru masuk)

**Verifikasi:**
```
Setiap polling cycle, partikel baru muncul dari atas bangunan.
Partikel naik, mengecil, lalu menghilang.
Warna partikel sesuai tipe transaksi.
```

---

### Langkah 19 — Sungai Data (DataRiver)

**Apa:** Aliran cahaya di tengah kota, kecepatan = TPS.

**File:** `src/scene/DataRiver.tsx`

**Isi:**
```
PlaneGeometry(20, 2) diposisikan di tengah grid (antara baris 1 dan 2)

Custom ShaderMaterial:
  Uniforms:
    uTime    — dari useFrame clock
    uSpeed   — dari store.networkStats.tps (normalized)
    uColor   — dari gas price color scale

  Vertex shader: standard
  Fragment shader:
    UV.x += uTime * uSpeed   → scrolling
    noise = simplex(UV * 3.0)  → pattern organik
    glow = smoothstep(...)     → tepi lembut
    gl_FragColor = vec4(uColor * glow, opacity)
```

**Bergantung pada:** Langkah 9 (store, networkStats), Langkah 11 (World)

**Verifikasi:**
```
Sungai cahaya mengalir di tengah kota.
Semakin tinggi TPS, semakin cepat alirannya.
```

---

### Langkah 20 — Langit Dinamis (SkyDome)

**Apa:** Hemisphere dome yang warnanya berubah sesuai network utilization.

**File:** `src/scene/SkyDome.tsx`

**Isi:**
```
SphereGeometry(25, 32, 32, 0, Math.PI*2, 0, Math.PI/2)
  → setengah bola besar menyelimuti kota

Custom ShaderMaterial:
  4 preset warna:
    LOW    = biru cerah (#87CEEB → #4A90D9)
    MEDIUM = biru emas  (#4A90D9 → #E8A317)
    HIGH   = oranye     (#E8A317 → #CC3333)
    PEAK   = merah gelap(#CC3333 → #1A0A0A)

  Lerp antar preset berdasar utilization %:
    < 5%   → LOW
    5-20%  → MEDIUM
    20-50% → HIGH
    > 50%  → PEAK

  Gradient vertikal: horizon lebih terang, atas lebih gelap
```

**Bergantung pada:** Langkah 9 (store, networkStats)

**Verifikasi:**
```
Langit cerah biru saat network santai.
Simulasi: set utilization 60% → langit berubah gelap kemerahan.
```

---

### Langkah 21 — Pulse Effect

**Apa:** Bangunan berkedip/membesar sesaat saat menerima transaksi baru.

**File:** `src/scene/GasBuilding.tsx` (tambah logic)

**Tambah:**
```typescript
// Track previous tx count
const prevCount = useRef(0);

useFrame((_, delta) => {
  const newCount = gasMetric.recentTxCount;
  if (newCount > prevCount.current) {
    // Ada tx baru masuk → pulse!
    pulseIntensity.current = 1.0;
  }
  prevCount.current = newCount;

  // Decay pulse
  pulseIntensity.current *= 0.95;

  // Apply pulse ke scale dan emissive
  const pulse = pulseIntensity.current;
  mesh.scale.x = baseWidth * (1 + pulse * 0.05);
  mesh.scale.z = baseWidth * (1 + pulse * 0.05);
  material.emissiveIntensity = baseEmissive + pulse * 0.5;
});
```

**Bergantung pada:** Langkah 17 (animasi dasar)

**Verifikasi:**
```
Saat data baru masuk, bangunan yang terima tx "berkedip" — 
sedikit membesar lalu kembali. Emissive glow sesaat.
```

---

### Langkah 22 — Optimasi Performa

**Apa:** Pastikan 60 FPS stabil. Perbaiki bottleneck.

**Checklist:**
```
□ useMemo untuk geometry & material yang tidak berubah shape-nya
□ React.memo untuk komponen yang jarang re-render
□ InstancedMesh untuk partikel (sudah di langkah 18)
□ Kurangi max partikel jika FPS < 50 (500 → 300 → 200)
□ Cek draw calls di Chrome DevTools → target < 100
□ Cek memory heap → target < 200 MB
□ Tidak ada memory leak (partikel di-recycle, bukan dibuat terus)
```

**Tool:**
```
Chrome DevTools → Performance tab → Record 10 detik
React Three Fiber DevTools (r3f-perf) → FPS counter
```

**Bergantung pada:** Langkah 16-21 (semua elemen real-time sudah ada)

**Verifikasi:**
```
60 FPS stabil selama 1 menit.
Memory tidak terus naik (stabil setelah 30 detik).
```

---

## TAHAP 5 — Wajah & Polish

> _Tujuan: UI overlay lengkap, interaksi bi-directional, post-processing, error handling, dan deploy._

---

### Langkah 23 — Dashboard Stats Overlay

**Apa:** Bar statistik di atas canvas 3D.

**File:** `src/ui/Dashboard.tsx`

**Isi:**
```
Fixed position di atas canvas (z-index di atas canvas)
Semi-transparent background + backdrop-blur

Konten:
  ⛽ Gas Price: 0.05 Gwei
  📊 TPS: 12.5 tx/s
  📦 Block: #1,234,567
  💰 Avg Fee: 0.000018 ETH
  🟢 Network: Healthy

Subscribe ke useGasStore → update angka real-time
```

**Render di `App.tsx`:** Sebagai sibling di samping `<Canvas>`

**Bergantung pada:** Langkah 9 (store), Langkah 16 (data update)

**Verifikasi:**
```
Stats bar tampil di atas canvas, angka update setiap 3 detik.
```

---

### Langkah 24 — Tabel Gas Fee

**Apa:** Tabel sortable semua tipe transaksi.

**File:** `src/ui/GasTable.tsx`

**Isi:**
```
Tabel 12 baris:
  Kolom: Tipe | Avg Gas | Avg Price | Count | Total Fee

Fitur:
  - Klik header kolom → sort ascending/descending
  - Color dot per tipe (match warna partikel)
  - Row hover → store.hoverType(type) → bangunan 3D glow
  - Row click → store.selectType(type) → kamera zoom ke bangunan
```

**Bergantung pada:** Langkah 9 (store), Langkah 23 (UI layout)

**Verifikasi:**
```
Tabel menampilkan 12 tipe dengan data benar.
Sort berfungsi. Hover row → bangunan 3D glow.
```

---

### Langkah 25 — Transaction Feed

**Apa:** Scrolling list transaksi terbaru.

**File:** `src/ui/TxFeed.tsx`

**Isi:**
```
Scrollable vertical list, max 50 item visible

Per item:
  [Warna dot] 0xab..cd | DEX_SWAP | 180K gas | 0.000018 ETH
  └─ Link ke: robinhoodchain.blockscout.com/tx/{hash}

Auto-scroll ke atas saat data baru masuk
Animasi slide-in untuk item baru
```

**Bergantung pada:** Langkah 9 (store.recentTxs)

**Verifikasi:**
```
Feed scroll menampilkan tx terbaru. Link bisa di-klik, buka Blockscout.
Item baru muncul di atas dengan animasi slide.
```

---

### Langkah 26 — Legend

**Apa:** Penjelasan arti warna dan ukuran.

**File:** `src/ui/Legend.tsx`

**Isi:**
```
Collapsible panel (toggle tampil/sembunyi)

Konten:
  Gas Price Scale:
    [gradient bar: hijau → kuning → merah]
    0.01          0.1          1.0+ Gwei

  Transaction Types:
    🔵 Transfer  🟢 ERC-20  🟡 Swap  🟠 Liquidity ...

  Building Size:
    Tinggi = gas used, Lebar = volume tx

  Particle Size:
    Besar = gas banyak, Kecil = gas sedikit
```

**Bergantung pada:** Langkah 23 (UI layout)

**Verifikasi:**
```
Legend tampil, bisa collapse/expand. Warna cocok dengan 3D scene.
```

---

### Langkah 27 — Interaksi Bi-directional

**Apa:** Sinkronisasi hover/klik antara 3D dan 2D.

**File modifikasi:**
- `src/scene/GasBuilding.tsx` — tambah `onPointerOver` → `store.hoverType()`
- `src/scene/GasBuilding.tsx` — tambah `onClick` → `store.selectType()`
- `src/scene/GasBuilding.tsx` — baca `store.hoveredType` → apply glow jika match
- `src/ui/GasTable.tsx` — row hover → `store.hoverType()`
- `src/scene/CameraController.tsx` — saat `selectedType` berubah, animate kamera ke bangunan

**Bergantung pada:** Langkah 12, 14, 24

**Verifikasi:**
```
Hover bangunan 3D → row di tabel ter-highlight.
Hover row di tabel → bangunan 3D glow.
Klik bangunan → kamera zoom in + panel detail tampil.
Klik row → sama seperti klik bangunan.
```

---

### Langkah 28 — Responsive Layout

**Apa:** Layout benar di desktop, tablet, mobile.

**File:** `src/App.tsx` + semua UI components

**Breakpoints:**
```
Desktop (>1024px):
  Canvas full screen + UI panel di kanan (width 360px)

Tablet (768-1024px):
  Canvas full screen + bottom sheet (height 40%)

Mobile (<768px):
  Canvas atas (60%) + scrollable UI bawah (40%)
  Kurangi partikel max (500 → 200)
  Sembunyikan DataRiver (performa)
```

**Bergantung pada:** Langkah 23-27 (semua UI components)

**Verifikasi:**
```
Resize browser → layout berubah sesuai breakpoint.
Mobile: performa tetap OK (cek FPS).
```

---

### Langkah 29 — Post-Processing

**Apa:** Efek visual cinematic — bloom, vignette.

**File:** `src/scene/World.tsx` (tambah)

**Isi:**
```tsx
<EffectComposer>
  <Bloom
    luminanceThreshold={0.8}
    luminanceSmoothing={0.9}
    intensity={0.5}
  />
  <Vignette offset={0.3} darkness={0.5} />
</EffectComposer>
```

**Bergantung pada:** Langkah 22 (performa sudah OK dulu)

**Verifikasi:**
```
Bangunan aktif punya glow bloom. Tepi layar sedikit gelap (vignette).
FPS tetap 60 setelah post-processing.
Jika FPS drop: kurangi intensity atau disable SSAO.
```

---

### Langkah 30 — Loading Screen

**Apa:** Tampilan saat pertama buka — progress bar sambil fetch data awal.

**File:** `src/ui/LoadingScreen.tsx`

**Isi:**
```
Tampil saat:
  - 3D assets belum loaded
  - Data pertama belum di-fetch

Konten:
  Logo "GasHood" (teks)
  "Connecting to Robinhood Chain..."
  [████████░░░░░░░░] 55%

Menggunakan useProgress() dari drei untuk track 3D loading
+ state isLoading dari store untuk data

Transisi: fade out saat semua siap
```

**Bergantung pada:** Langkah 10 (Canvas), Langkah 16 (data fetch)

**Verifikasi:**
```
Buka halaman → loading screen tampil → progress naik → fade out → kota muncul.
```

---

### Langkah 31 — Error Handling

**Apa:** Tangani semua kemungkinan error tanpa crash.

**File:** `src/ui/ErrorToast.tsx` + modifikasi collector & App

**Skenario:**
```
1. RPC tidak bisa connect:
   → Toast: "Cannot connect to Robinhood Chain. Retrying..."
   → Retry 3× dengan backoff (3s → 6s → 12s)
   → Setelah 3× gagal: "Connection failed. Using cached data."

2. Rate limited (429):
   → Toast: "Rate limited. Slowing down..."
   → Polling interval naik otomatis (3s → 5s → 10s)

3. WebGL not supported:
   → Tampilkan fallback: hanya tabel 2D (tanpa 3D)
   → Toast: "3D not supported. Showing table view."

4. Block kosong (0 tx):
   → Tidak error, tapi tampilkan: "Waiting for transactions..."

5. Unexpected error:
   → Error boundary React catch
   → Toast: "Something went wrong. Refreshing data..."
   → Auto-retry
```

**Bergantung pada:** Langkah 16 (polling), Langkah 23-26 (UI ada)

**Verifikasi:**
```
Matikan internet → toast muncul → nyalakan lagi → auto-recover.
Tidak ada uncaught error di console.
```

---

### Langkah 32 — Production Build

**Apa:** Pastikan build sukses dan optimized.

**Perintah:**
```bash
npm run build
npm run preview    # test build lokal
```

**Checklist:**
```
□ npm run build → tanpa error
□ dist/ folder size < 2 MB (pre-gzip)
□ npm run preview → semua fitur jalan
□ Lighthouse audit → Performance > 80
□ Console: 0 error, 0 warning
□ .env variables tidak bocor ke client (cek source map)
```

**Bergantung pada:** Semua langkah sebelumnya

**Verifikasi:**
```
npm run preview → buka http://localhost:4173
Semua fitur identik dengan dev mode.
```

---

### Langkah 33 — Deploy

**Apa:** Deploy ke hosting publik.

**Opsi A — Vercel (recommended):**
```bash
npm install -g vercel
vercel

# Set env variables di Vercel Dashboard:
# VITE_RPC_URL, VITE_BLOCKSCOUT_API_URL, VITE_POLLING_INTERVAL
```

**Opsi B — Netlify:**
```bash
npm run build
# Upload dist/ ke Netlify
```

**Post-deploy checklist:**
```
□ URL publik bisa diakses
□ 3D scene ter-render
□ Data real-time update (tunggu 30 detik, lihat angka berubah)
□ Link Blockscout berfungsi
□ Mobile layout benar
□ HTTPS aktif
□ Custom domain (opsional)
```

**Verifikasi:**
```
Buka URL publik dari HP → kota 3D tampil, data update, interaksi berfungsi.
```

---

## Checklist Final — Kriteria Proyek Selesai

| # | Kriteria | Cara Cek |
|---|---|---|
| 1 | Data gas fee akurat | Bandingkan angka di app vs Blockscout explorer (selisih < 1%) |
| 2 | Real-time update | Data berubah dalam 10 detik setelah block baru |
| 3 | 12 tipe transaksi | Semua tipe muncul sebagai bangunan terpisah |
| 4 | Bangunan beranimasi | Tinggi dan warna berubah smooth |
| 5 | Partikel hidup | Muncul saat tx baru, menghilang setelah 3 detik |
| 6 | Sungai mengalir | Kecepatan berubah sesuai TPS |
| 7 | Langit berubah | Warna sesuai network load |
| 8 | Navigasi kamera | Orbit, zoom, pan, auto-rotate |
| 9 | Hover & klik | Tooltip, detail panel, interaksi 3D↔2D |
| 10 | Dashboard update | Stats, tabel, feed — semua real-time |
| 11 | 60 FPS | Stabil di desktop mid-range |
| 12 | Error resilient | Tidak crash saat RPC down |
| 13 | Responsive | Desktop, tablet, mobile |
| 14 | Deploy live | URL publik bisa diakses siapa saja |
