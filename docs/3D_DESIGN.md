# Konsep Dunia 3D — "Gas City"

Dokumen ini menjelaskan konsep visual, mapping data ke objek 3D, interaksi user, dan wireframe untuk dunia virtual GasHood.

---

## Filosofi Desain

> Mewakili aktivitas gas fee blockchain sebagai **kota hidup** yang bernapas — bangunan tumbuh dan menyusut, partikel berterbangan, langit berubah warna, dan sungai data mengalir. User merasakan "kesehatan" jaringan secara intuitif melalui visual, bukan hanya angka.

### Prinsip Visual
1. **Data-Driven** — Setiap elemen visual dipetakan dari data nyata
2. **Legible at Glance** — Kondisi network terlihat dalam 2 detik pertama
3. **Aesthetic** — Premium look, bukan dashboard biasa
4. **Performant** — Target 60 FPS, max 500 instanced objects

---

## Peta Dunia 3D

```
         ┌──────────────────────────────────────────────┐
         │              ☁  SkyDome  ☁                    │
         │    (warna berubah sesuai network load)        │
         │                                               │
         │   ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐       │
         │   │NATV │  │ERC20│  │APPRV│  │ SWAP│        │
         │   │  █  │  │ ██  │  │  █  │  │████ │        │
         │   │  █  │  │ ██  │  │  █  │  │████ │        │
         │   │  █  │  │ ██  │  │     │  │████ │        │
         │   └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘        │
         │      │        │        │        │             │
         │ ═════╧════════╧════════╧════════╧══════      │
         │ ~~~ DataRiver ~~~ DataRiver ~~~ DataRiver ~~  │
         │ ═══════════════════════════════════════════   │
         │      │        │        │        │             │
         │   ┌──┴──┐  ┌──┴──┐  ┌──┴──┐  ┌──┴──┐       │
         │   │ LIQ │  │BRDG↑│  │BRDG↓│  │ NFT │        │
         │   │ ██  │  │  █  │  │  █  │  │ █   │        │
         │   │ ██  │  │     │  │     │  │     │        │
         │   └─────┘  └─────┘  └─────┘  └─────┘        │
         │                                               │
         │   ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐       │
         │   │MINT │  │DEPLY│  │CALL │  │ RWA │        │
         │   │  █  │  │  █  │  │ ███ │  │ ██  │        │
         │   │     │  │     │  │ ███ │  │ ██  │        │
         │   └─────┘  └─────┘  └─────┘  └─────┘        │
         │                                               │
         │           [Ground Plane + Grid]               │
         └──────────────────────────────────────────────┘
```

**Layout:** Grid 4 kolom × 3 baris, dipisahkan oleh "DataRiver" di tengah.

---

## Mapping Data → Elemen 3D

### Bangunan (GasBuilding)

Setiap tipe transaksi = 1 bangunan. Total 12 bangunan.

| Properti 3D | Data Source | Range | Formula |
|---|---|---|---|
| **Height (Y)** | `avgGasPrice` (Gwei, real-time Blockscout) | 7.5 — 150 units | linear `gwei × (50/4.5)` — rasio 1 Gwei = 50 m, clamp 7.5–150 |
| **Width (X,Z)** | `recentTxCount` | 0.5 — 2.0 units | `normalize(txCount, 0, maxCount) × 1.5 + 0.5` |
| **Color** | `avgGasPrice` (Gwei) | Gradient | Lihat tabel warna di bawah |
| **Emissive** | `recentTxCount` | 0 — 1 intensity | Lebih banyak tx = lebih terang |
| **Opacity** | Activity | 0.6 — 1.0 | Tidak aktif = semi-transparan |

### Color Scale (Gas Price Bracket)

```
Gas Price (Gwei)    Color             Hex        Meaning
───────────────────────────────────────────────────────
< 0.01              Hijau terang     #00FF88    Sangat murah
0.01 — 0.05         Hijau            #44CC66    Murah
0.05 — 0.1          Kuning-hijau     #88BB44    Normal
0.1 — 0.5           Kuning           #CCAA22    Sedikit mahal
0.5 — 1.0           Oranye           #FF7722    Mahal
> 1.0               Merah            #FF2244    Sangat mahal
```

> **Catatan:** Range ini spesifik untuk Robinhood Chain (L2 Arbitrum) yang gas-nya sangat murah. Akan di-kalibrasi saat development berdasarkan data aktual.

### Animasi Bangunan

```typescript
// Smooth lerp setiap frame
currentHeight = THREE.MathUtils.lerp(currentHeight, targetHeight, 0.05);
currentColor.lerp(targetColor, 0.03);

// Pulse effect saat tx baru masuk
if (newTxReceived) {
  scale.set(1.05, 1.02, 1.05); // brief scale up
  emissiveIntensity = 1.5;     // flash
  // decay kembali ke normal dalam 0.5 detik
}
```

---

### Partikel (GasParticles)

Setiap transaksi baru = 1 partikel muncul dari bangunan terkait.

| Properti | Data Source | Deskripsi |
|---|---|---|
| **Spawn position** | Tipe tx → posisi bangunan | Muncul dari atas bangunan |
| **Color** | Tipe tx | Warna unik per tipe |
| **Size** | `gasUsed` | Tx besar = partikel besar |
| **Velocity** | Random + upward | Naik + drift horizontal random |
| **Lifetime** | 3 detik | Fade out lalu recycle |

**Warna per tipe transaksi:**
```
NATIVE_TRANSFER  → #4FC3F7 (biru muda)
ERC20_TRANSFER   → #81C784 (hijau)
ERC20_APPROVE    → #AED581 (hijau muda)
DEX_SWAP         → #FFD54F (kuning emas)
LIQUIDITY        → #FF8A65 (oranye)
BRIDGE_DEPOSIT   → #CE93D8 (ungu muda)
BRIDGE_WITHDRAW  → #B39DDB (lavender)
NFT_TRANSFER     → #F48FB1 (pink)
NFT_MINT         → #EF5350 (merah)
CONTRACT_DEPLOY  → #90A4AE (abu-abu biru)
CONTRACT_CALL    → #78909C (abu-abu)
RWA_TOKEN        → #4DD0E1 (cyan)
```

**Implementasi InstancedMesh:**
```typescript
const MAX_PARTICLES = 500;
const particleRef = useRef<THREE.InstancedMesh>(null);
const dummy = useMemo(() => new THREE.Object3D(), []);
const particleData = useRef<ParticleData[]>([]);

useFrame((_, delta) => {
  particleData.current.forEach((p, i) => {
    p.life -= delta;
    p.position.y += p.velocity.y * delta;
    p.position.x += p.velocity.x * delta;

    dummy.position.copy(p.position);
    dummy.scale.setScalar(p.life > 0 ? p.size * (p.life / p.maxLife) : 0);
    dummy.updateMatrix();
    particleRef.current!.setMatrixAt(i, dummy.matrix);
  });
  particleRef.current!.instanceMatrix.needsUpdate = true;
});
```

---

### SkyDome

Dome hemisphere yang merespons kondisi jaringan.

| Network Load | Warna Langit | Elemen Tambahan |
|---|---|---|
| Rendah (< 5% util) | Biru cerah #87CEEB | Awan putih tipis, matahari |
| Sedang (5-20%) | Biru-oranye sunset | Awan sedang |
| Tinggi (20-50%) | Oranye kemerahan | Awan tebal, matahari redup |
| Sangat tinggi (> 50%) | Merah gelap | Awan gelap, kilat sesekali |

**Implementasi:** Custom shader gradient yang di-lerp antar state.

---

### DataRiver

Aliran visual di tengah kota yang merepresentasikan throughput jaringan.

| Properti | Data Source |
|---|---|
| **Kecepatan alir** | TPS (transactions per second) |
| **Intensitas cahaya** | Volume transaksi dalam window |
| **Lebar** | Network utilization % |
| **Warna** | Sama dengan color scale gas price |

**Implementasi:** Plane dengan custom ShaderMaterial menggunakan scrolling noise texture.

```glsl
// Fragment shader pseudocode
uniform float uTime;
uniform float uSpeed;
uniform vec3 uColor;

void main() {
  vec2 uv = vUv;
  uv.x += uTime * uSpeed;
  float noise = snoise(uv * 3.0);
  float glow = smoothstep(0.3, 0.7, noise);
  gl_FragColor = vec4(uColor * glow, glow * 0.8);
}
```

---

## Label & Signage

Setiap bangunan memiliki label floating:

```
     ┌─────────────────┐
     │  DEX SWAP        │   ← Nama tipe
     │  Avg: 0.05 Gwei  │   ← Gas price rata-rata
     │  Vol: 234 tx     │   ← Volume transaksi
     └─────────────────┘
           │
         ┌─┴─┐
         │███│   ← Bangunan
         │███│
         └───┘
```

**Implementasi:** `<Text>` dari `@react-three/drei` dengan billboard behavior (selalu menghadap kamera).

---

## Interaksi User

### 1. Navigasi Kamera

| Input | Aksi |
|---|---|
| **Drag kiri** | Orbit (putar keliling kota) |
| **Scroll** | Zoom in/out |
| **Drag kanan** | Pan (geser) |
| **Double-click kosong** | Reset ke posisi default |
| **Idle 10 detik** | Auto-rotate pelan |

### 2. Hover

```
Mouse hover di bangunan:
  → Bangunan glow (emissive intensity naik)
  → Tooltip muncul:
    ┌──────────────────────────┐
    │ ⛽ DEX SWAP               │
    │ Avg Gas Used: 180,000    │
    │ Avg Price: 0.05 Gwei     │
    │ Fee: ~0.000009 ETH       │
    │ Volume: 234 tx (5 min)   │
    │ Trend: ↗ +12%            │
    │ Klik untuk detail →      │
    └──────────────────────────┘
```

### 3. Klik Bangunan

```
Klik bangunan → Panel detail slide dari kanan:
  ┌──────────────────────────────┐
  │ ✕  DEX SWAP Detail           │
  ├──────────────────────────────┤
  │                              │
  │  Gas Used Distribution       │
  │  ┌──────────────────────┐   │
  │  │  ▄▄████▄▄░░          │   │  ← Mini histogram
  │  │  min   avg   max     │   │
  │  └──────────────────────┘   │
  │                              │
  │  Stats:                      │
  │  • Min Gas: 120,000          │
  │  • Max Gas: 350,000          │
  │  • Avg Gas: 180,000          │
  │  • Avg Price: 0.05 Gwei      │
  │  • Total Fee: 0.042 ETH      │
  │  • Tx Count: 234              │
  │                              │
  │  Recent Transactions:         │
  │  0xab..cd  180K  0.05 Gwei   │
  │  0xef..12  195K  0.04 Gwei   │
  │  0x34..56  165K  0.06 Gwei   │
  │                              │
  │  [View on Blockscout ↗]      │
  └──────────────────────────────┘
```

### 4. Time Slider (Opsional, jika historical data aktif)

```
  ◄ ──────────●──────────── ►
  -1h                    now
```
Geser slider mengubah data window, bangunan dan langit beranimasi ke state di waktu tersebut.

---

## Camera Presets

| Preset | Posisi | Use Case |
|---|---|---|
| **Overview** | Atas miring 45° | Default, lihat semua bangunan |
| **Street Level** | Dekat ground | Immersive, lihat partikel dekat |
| **Bird Eye** | Langsung atas | Peta, lihat layout |
| **Focus** | Zoom ke 1 bangunan | Saat klik bangunan |

---

## Responsivitas

| Viewport | Behavior |
|---|---|
| **Desktop (>1024px)** | Full 3D + side panel overlay |
| **Tablet (768-1024px)** | 3D scene + bottom sheet overlay |
| **Mobile (<768px)** | Simplified 3D (kurangi objek) + full overlay mode |

---

## Post-Processing Effects

| Effect | Tujuan | Library |
|---|---|---|
| **Bloom** | Glow pada bangunan aktif | @react-three/postprocessing |
| **Vignette** | Focus ke tengah | @react-three/postprocessing |
| **SSAO** | Depth pada bangunan | @react-three/postprocessing |
| **Tone Mapping** | Warna cinematic | Three.js built-in |
| **Fog** | Depth, hide edge | Three.js built-in |

---

## Asset List

| Asset | Format | Source | Catatan |
|---|---|---|---|
| Ground texture | PNG/JPG | Procedural atau textures.com | Grid pattern, subtle |
| Environment map | HDR | Polyhaven.com | City/sunset preset |
| Particle sprite | PNG | Custom | Soft glow circle |
| Noise texture | PNG | Procedural | Untuk DataRiver shader |
| Font | WOFF2 | Google Fonts | Inter atau JetBrains Mono |

> **Catatan:** Semua bangunan menggunakan primitive geometry (BoxGeometry) — tidak perlu model GLTF untuk fase awal. Model custom bisa ditambahkan di iterasi berikutnya.
