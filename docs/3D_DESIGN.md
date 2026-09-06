# Konsep Dunia 3D — "Gas City"

Dokumen ini menjelaskan konsep visual, mapping data ke objek 3D, interaksi user, dan wireframe untuk dunia virtual GasHood.

---

## Filosofi Desain

> Mewakili aktivitas gas fee blockchain sebagai **kota hidup** yang bernapas — bangunan tumbuh dan menyusut, partikel berterbangan, langit berubah warna, sungai data mengalir, pohon tumbuh, dan mobil berlalu-lalang. User merasakan "kesehatan" jaringan secara intuitif melalui visual, bukan hanya angka.

### Prinsip Visual
1. **Data-Driven** — Setiap elemen visual dipetakan dari data nyata
2. **Legible at Glance** — Kondisi network terlihat dalam 2 detik pertama
3. **Aesthetic** — Ethereal Glass aesthetic, premium look
4. **Performant** — Target 60 FPS, max 500 instanced objects

---

## Peta Dunia 3D

```
         ┌──────────────────────────────────────────────────────┐
         │                ☁  SkyDome  ☁                         │
         │      (warna berubah sesuai network load)             │
         │                                                      │
         │  🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲  │
         │  🌲  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  🌲       │
         │  🌲  │NATV │  │ERC20│  │APPRV│  │SWAP │  🌲       │
         │  🌲  │  █  │  │ ██  │  │████ │  │████ │  🌲       │
         │  🌲  │  █  │  │ ██  │  │████ │  │████ │  🌲       │
         │  🌲  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘  🌲       │
         │  🌲     │        │        │        │     🌲       │
         │  🌲═════╧════════╧════════╧════════╧═════🌲       │
         │  🌲~~~ DataRiver ~~~ DataRiver ~~~ DataRiver ~~🌲  │
         │  🌲═════════════════════════════════════════🌲     │
         │  🌲     ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  🌲   │
         │  🌲     │LQDTY│  │BRDG │  │BRGW │  │NFTT │  🌲   │
         │  🌲     │  █  │  │ ██  │  │████ │  │████ │  🌲   │
         │  🌲     │  █  │  │ ██  │  │████ │  │████ │  🌲   │
         │  🌲     └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘  🌲   │
         │  🌲        │        │        │        │     🌲   │
         │  🌲  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  🌲   │
         │  🌲  │NFTM │  │DEPL │  │CALL │  │RWA  │  🌲   │
         │  🌲  │  █  │  │ ██  │  │████ │  │████ │  🌲   │
         │  🌲  │  █  │  │ ██  │  │████ │  │████ │  🌲   │
         │  🌲  └─────┘  └─────┘  └─────┘  └─────┘  🌲   │
         │  🌲🚗  🚕  🚗  🚙  🚕  🚗  🚙  🚕  🚗  🌲   │
         │  🌲═════════════ Ring Avenue ════════════🌲     │
         │  🌲  ════════════ Highway ════════════════  🌲   │
         │  🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲🌲  │
         └──────────────────────────────────────────────────────┘
```

**Layout:** Grid 4×3 = 12 bangunan, spacing 4 × CITY_SCALE (60 units). DataRiver di z = SPACING/2. Highway di luar ring avenue.

---

## Mapping Data → Elemen 3D

### Bangunan (GasBuilding)

Setiap tipe transaksi = 1 bangunan. Total 12 bangunan.

| Properti 3D | Data Source | Range | Formula |
|---|---|---|---|
| **Height (Y)** | `avgGasPrice` (Gwei) | 7.5 — 150 units | `gwei × (50/4.5)` — 1 Gwei = 50m |
| **Width (X,Z)** | `recentTxCount` | 0.5 — 2.0 units | `normalize(txCount, 0, 50) × 1.5 + 0.5` |
| **Color** | `avgGasPrice` (Gwei) | Gradient | Interpolasi linear dari GAS_BRACKETS |
| **Emissive** | `recentTxCount` | 0.1 — 0.8 intensity | + pulse effect saat tx baru |
| **Opacity** | `avgGasPrice` | 0.6 — 1.0 | Tidak aktif = semi-transparan |

### Color Scale (GAS_BRACKETS)

Smooth interpolation dari `tx-theme.ts`:

```
Gas Price (Gwei)    Color             Hex        Meaning
───────────────────────────────────────────────────────
< 0.01              Hijau terang     #00FF88    Sangat murah
0.01 — 0.05         Hijau            #44CC66    Murah
0.05 — 0.1          Kuning-hijau     #88BB44    Normal
0.1 — 0.5           Kuning           #CCAA22    Sedikit mahal
0.5 — 1.0           Oranye           #FF7722    Mahal
≥ 1.0               Merah            #FF2244    Sangat mahal
```

### Arsitektur Bangunan (BuildingFacade)

```
     ┌─────────┐  ← Cap atap (parapet, metalness tinggi)
     │ ▓▓▓▓▓▓▓ │  ← Stack 3 (setback, warna lebih gelap)
     │ ▓▓▓▓▓▓▓ │  ← Stack 2
     │ ▓▓▓▓▓▓▓ │  ← Stack 1 (fasad kaca/beton)
     ├─────────┤
     │░░░░░░░░░│  ← Podium/lobby (batu gelap + kaca pintu masuk)
     └─────────┘
```

- **Glass archetype** — kaca biru gelap, refleksi Environment city
- **Concrete archetype** — beton mid-rise, roughness tinggi
- **Podium** — 1.08× lebar tower, batu gelap + pita kaca
- **Rooftop** — AC units, antena, water tower (InstancedMesh global)

### Animasi Bangunan

```typescript
// Smooth lerp setiap frame
currentHeight = THREE.MathUtils.lerp(currentHeight, targetHeight, 0.05);
currentColor.lerp(targetColor, 0.03);

// Pulse effect saat tx baru masuk
if (newTxReceived) {
  pulseRef.current = 1;
  // decay ×0.95/frame
}
```

---

### Partikel (GasParticles)

Setiap transaksi baru = 1 partikel muncul dari bangunan terkait.

| Properti | Data Source | Deskripsi |
|---|---|---|
| **Spawn position** | Tipe tx → posisi bangunan | Muncul dari atas bangunan |
| **Color** | Tipe tx | Warna unik per tipe (12 warna) |
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
BRIDGE_WITHDRAW  → #B39DDB (ungu)
NFT_TRANSFER     → #F48FB1 (pink)
NFT_MINT         → #EF5350 (merah)
CONTRACT_DEPLOY  → #90A4AE (abu-abu)
CONTRACT_CALL    → #78909C (abu-abu gelap)
RWA_TOKEN        → #4DD0E1 (cyan)
```

**Implementasi InstancedMesh:**
- Max 500 instance (200 di mobile < 768px)
- Ring-buffer spawn dari `selectNewTxs()` (tahan ring buffer penuh)
- Idle path: skip loop + upload matrix saat 0 active particles

---

### SkyDome

Dome hemisphere yang merespons kondisi jaringan.

| Network Load | Warna Langit | Threshold |
|---|---|---|
| Rendah (0-5%) | Biru gelap #1a3a5c → #87CEEB | `avgBlockGas / BLOCK_GAS_LIMIT` |
| Sedang (5-20%) | Biru-oranye #2a4a6c → #E8A060 | |
| Tinggi (20-50%) | Oranye kemerahan #4a3a2c → #CC4422 | |
| Sangat tinggi (50-100%) | Merah gelap #3a1a1a → #881111 | |
| Puncak (> 100%) | Merah pekat #1a0a0a → #881111 | |

**Implementasi:** Custom shader gradient dengan 5 preset, lerp antar state.

---

### DataRiver

Aliran visual di tengah kota yang merepresentasikan throughput jaringan.

| Properti | Data Source |
|---|---|
| **Kecepatan alir** | TPS (transactions per second) |
| **Intensitas cahaya** | Volume transaksi dalam window |
| **Warna** | Deep water blue-green + gas price subtle tint |
| **Kedalaman** | Alpha gradient (tengah transparan, tepi opaque) |

**Implementasi:** Plane dengan custom ShaderMaterial:
- FBM 4-octave noise (wave, ripple, sparkle)
- Specular highlight + caustics
- Fresnel rim light
- 3 lapis: riverbed → bank → permukaan air

---

### Vegetation

220 pohon + 800 rumput di area map.

| Komponen | Jumlah | Detail |
|---|---|---|
| Pohon (3 tipe) | 220 | Kerucut biasa, lebar, bundar |
| Canopy layers | 3 per pohon | Bawah, atas, pucuk |
| Rumput | 800 | Box blade, 3 hijau bervariasi |

**Spawn rules:**
- Rejection sampling: avoids buildings, river, plaza, sidewalk
- Minimum spacing 1.8 × CITY_SCALE
- PRNG deterministik (mulberry32, seed tetap)

---

### RoadNetwork

Jaringan jalan kota.

| Komponen | Detail |
|---|---|
| Ring avenue | 4 strip, lebar 1.6 (2 lajur), di ±9.75 × CITY_SCALE |
| 3 jalan lurus | z = -SPACING/2, -SPACING, -1.5×SPACING |
| Highway keliling | 4 strip, lebar 2.4 (3 lajur), di ±14 × CITY_SCALE |
| Viaduct tol | x = 60, dek y = 6, pilar + gerbang |
| Jembatan | Dek segmen miring, pagar, 2 sisi |
| Marka jalan | Garis tepi solid + tengah putus-putus |
| Zebra cross | 4 buah (1 per sisi ring) |
| Lampu jalan | 12 tiang + kepala (vertex color) |

---

### Traffic

104 mobil instanced di 6 jalur.

| Jalur | Jumlah | Detail |
|---|---|---|
| Ring avenue | 40 | 20 per arah, 2 lajur |
| 3 jalan lurus | 24 | 8 per arah |
| Highway keliling | 24 | 12 per arah, 3 lajur |
| Viaduct tol | 16 | 8 per arah |

**Kepadatan:**
- Mengikuti `networkStats.trafficDensity` (0-100, dari Blockscout utilization)
- Transisi halus: lerp 0.03/frame
- Mobil non-aktif: scale 0, posisi y = -100
- Kecepatan: BASE_SPEED tetap (2.2 unit/s), tidak berubah

**Palet warna:**
- 7 warna sipil + taksi kuning (~15%)
- Kabin gelap seragam

---

## Label & Signage

Setiap bangunan memiliki 2 label floating:

```
     ┌─────────────────┐
     │  CONTRACT CALL   │   ← Nama tipe (uppercase)
     │  0.650 Gwei      │   ← Gas price rata-rata
     └─────────────────┘
           │
         ┌─┴─┐
         │███│   ← Bangunan
         │███│
         └───┘
```

**Implementasi:** `<Billboard>` + `<Text>` dari `@react-three/drei`.

---

## Interaksi User

### 1. Navigasi Kamera

| Input | Aksi |
|---|---|
| **Drag kiri** | Orbit (putar keliling kota) |
| **Scroll** | Zoom in/out |
| **Drag kanan** | Pan (geser) |
| **Idle** | Auto-rotate (0.3 rad/s) |

### 2. Hover

```
Mouse hover di bangunan:
  → Bangunan glow (emissive intensity ×1.8)
  → Scale ×1.05
  → Row di GasTable highlight
```

### 3. Klik Bangunan

```
Klik bangunan → DetailPanel slide dari kanan:
  ┌──────────────────────────────┐
  │ ✕  CONTRACT CALL Detail      │
  ├──────────────────────────────┤
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
  │                              │
  │  [View on Blockscout ↗]      │
  └──────────────────────────────┘
```

---

## Camera Presets

| Preset | Posisi | Use Case |
|---|---|---|
| **Default** | [15, 12, 15] × CITY_SCALE, fov 50 | Overview kota |
| **Focus** | Zoom ke bangunan yang diklik | Saat select |

---

## Responsivitas

| Viewport | Behavior |
|---|---|
| **Desktop (>1024px)** | Full 3D + SSAO + side panel overlay |
| **Tablet (768-1024px)** | 3D scene + bottom sheet overlay |
| **Mobile (<768px)** | Simplified 3D (no DataRiver, no SSAO) + full overlay |

---

## Post-Processing Effects

| Effect | Tujuan | Kondisi |
|---|---|---|
| **Bloom** | Glow pada bangunan aktif | Semua viewport |
| **Vignette** | Focus ke tengah | Semua viewport |
| **SSAO** | Depth contact shadow | Desktop ≥ 1024px only |
| **Film Grain** | Tekstur analogis | Desktop ≥ 1024px only |
| **Fog** | Depth, hide edge | Semua viewport |
| **Tone Mapping** | Warna cinematic | Three.js built-in |

---

## Performance

| Metrik | Target |
|---|---|
| FPS | ≥ 60 |
| Max instanced objects | 500 particles + 104 cars + 220 trees |
| Draw calls | ≤ 30 (instancing) |
| Texture memory | < 50 MB (procedural canvas) |
| Memory | < 200 MB |
