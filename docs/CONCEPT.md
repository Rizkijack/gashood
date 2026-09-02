# GasHood — Konsep & Cara Kerja

> Bagaimana gas fee blockchain berubah menjadi kota 3D yang hidup

---

## Ide Inti

Bayangkan kamu buka Blockscout explorer Robinhood Chain. Yang kamu lihat: **tabel angka** — gas price, gas used, fee, hash, method. Membosankan dan sulit dicerna cepat.

GasHood mengubah semua angka itu jadi **kota hidup** yang bisa kamu rasakan kondisinya dalam 2 detik pertama tanpa baca satu angka pun.

---

## Apa yang Ditunjukkan?

**Satu pertanyaan utama:** _"Berapa biaya tiap jenis aktivitas di Robinhood Chain sekarang, dan bagaimana kondisinya?"_

Secara spesifik:

| Pertanyaan User | Jawaban Visual di Kota |
|---|---|
| Swap token mahal tidak sekarang? | Lihat bangunan "SWAP" — tinggi = mahal, pendek = murah |
| Aktivitas apa yang paling ramai? | Bangunan mana yang paling lebar dan banyak partikelnya |
| Network lagi sibuk? | Langit gelap kemerahan = sibuk, cerah biru = santai |
| Ada lonjakan gas? | Bangunan tiba-tiba tumbuh tinggi + warna berubah merah |
| Transfer biasa vs swap, beda jauh? | Bandingkan tinggi bangunan "TRANSFER" vs "SWAP" langsung |

---

## Bagaimana Gas Fee Jadi Kota

Alurnya begini:

```
BLOCKCHAIN                    DATA                         KOTA 3D
─────────                    ─────                        ────────

Block #1234567        ──►   Parsing:                 ──►  12 Bangunan
 ├─ tx: transfer ETH        "ini native transfer"         masing-masing
 ├─ tx: swap di Uniswap     "ini DEX swap"                mewakili 1 tipe
 ├─ tx: approve USDC        "ini ERC-20 approve"          transaksi
 ├─ tx: mint NFT            "ini NFT mint"
 └─ tx: bridge ETH          "ini bridge deposit"

Setiap tx punya:        ──►  Dihitung per tipe:      ──►  Jadi properti visual:
 • gasUsed: 180,000          avg gasUsed = 175,000         TINGGI bangunan
 • effectiveGasPrice         avg price = 0.05 Gwei         WARNA bangunan
 • fee: 0.000018 ETH         jumlah tx = 234               LEBAR bangunan
                             trend: naik 12%               INTENSITAS cahaya
```

---

## Peta Kota

**1 bangunan = 1 tipe transaksi.** Total 12 bangunan di kota:

```
┌──────────┬──────────┬──────────┬──────────┐
│ Transfer │  ERC-20  │ Approve  │   Swap   │   ← Baris 1: aktivitas harian
│  ETH     │ Transfer │  Token   │  (DEX)   │
├──────────┴──────────┴──────────┴──────────┤
│ ~~~~~~~~~~~ Sungai Data ~~~~~~~~~~~~~~~~~ │   ← Aliran = TPS network
├──────────┬──────────┬──────────┬──────────┤
│Liquidity │ Bridge   │ Bridge   │   NFT    │   ← Baris 2: DeFi & bridge
│ Add/Rem  │ Deposit  │ Withdraw │ Transfer │
├──────────┼──────────┼──────────┼──────────┤
│   NFT    │ Contract │ Contract │   RWA    │   ← Baris 3: advanced
│   Mint   │  Deploy  │   Call   │  Token   │
└──────────┴──────────┴──────────┴──────────┘
```

Setiap bangunan **bernapas** — berubah terus sesuai data real-time:

```
Gas murah (0.01 Gwei)          Gas mahal (1.0 Gwei)

     ┌─┐                           ┌───┐
     │ │  pendek                    │███│
     │ │  hijau                     │███│  tinggi
     │ │  redup                     │███│  merah
     └─┘                           │███│  terang bersinar
                                   │███│
   "SWAP"                          │███│
  12 tx/menit                      └───┘
                                  "SWAP"
                                 890 tx/menit
```

---

## 5 Elemen yang Bergerak di Kota

### 1. Bangunan Tumbuh & Menyusut

Setiap 3 detik, data gas fee terbaru masuk. Bangunan naik-turun secara smooth (bukan loncat).

- **Tinggi** = rata-rata gas yang dipakai (`avgGasUsed`)
- **Lebar** = jumlah transaksi dalam window terakhir
- **Warna** = bracket harga gas:

```
  🟢 < 0.01 Gwei   Sangat murah
  🟢 0.01 — 0.05    Murah
  🟡 0.05 — 0.1     Normal
  🟡 0.1 — 0.5      Sedikit mahal
  🟠 0.5 — 1.0      Mahal
  🔴 > 1.0 Gwei     Sangat mahal
```

- **Cahaya** = semakin banyak transaksi, semakin terang bangunan bersinar (emissive glow)

### 2. Partikel Beterbangan

Setiap transaksi baru yang masuk = **1 partikel** muncul dari atas bangunan terkait, naik ke udara, lalu menghilang.

- Ukuran partikel = gas yang dipakai transaksi tersebut (tx besar = partikel besar)
- Warna partikel = unik per tipe transaksi (swap kuning emas, bridge ungu, NFT pink, dll)
- Lifetime = 3 detik lalu fade out
- Max 500 partikel sekaligus di layar

Efeknya: kalau tipe tertentu lagi ramai (misal swap saat memecoin launch), bangunan itu dipenuhi partikel beterbangan — langsung terlihat mana yang sibuk.

### 3. Sungai Data Mengalir

Di tengah kota ada aliran cahaya seperti sungai digital.

- **Kecepatan aliran** = TPS (transaksi per detik) — makin cepat = makin banyak throughput
- **Intensitas cahaya** = volume transaksi total
- **Warna** = mengikuti color scale gas price

### 4. Langit Berubah Warna

Langit dome di atas kota merepresentasikan **kesehatan keseluruhan network**:

| Kondisi Network | Langit |
|---|---|
| Santai (< 5% utilization) | ☀️ Biru cerah, awan tipis |
| Normal (5–20%) | 🌤️ Biru keemasan, awan sedang |
| Sibuk (20–50%) | 🌅 Oranye kemerahan, awan tebal |
| Congested (> 50%) | 🌩️ Merah gelap, awan gelap |

Transisi antar state terjadi smooth — langit perlahan berubah warna seiring network load naik/turun.

### 5. Label & Papan Tanda

Setiap bangunan punya floating text di atasnya:

```
     ┌─────────────────┐
     │  DEX SWAP        │
     │  Avg: 0.05 Gwei  │
     │  Vol: 234 tx     │
     └─────────────────┘
           │
         ┌─┴─┐
         │███│
         │███│
         └───┘
```

Label selalu menghadap kamera (billboard), jadi dari sudut mana pun tetap terbaca.

---

## Interaksi User

Ini bukan video pasif — user bisa **menjelajah** kota:

### Navigasi

| Input | Aksi |
|---|---|
| 🖱️ Drag kiri | Putar kota (orbit), lihat dari sudut lain |
| 🔍 Scroll | Zoom in ke bangunan tertentu / zoom out |
| 🖱️ Drag kanan | Geser (pan) |
| 🖱️ Double-click kosong | Reset ke posisi default |
| ⏱️ Idle 10 detik | Auto-rotate pelan |

### Hover Bangunan

```
Mouse hover di bangunan → bangunan glow + tooltip muncul:

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

### Klik Bangunan

```
Klik bangunan → kamera zoom in + panel detail slide dari kanan:

  ┌──────────────────────────────┐
  │ ✕  DEX SWAP Detail           │
  ├──────────────────────────────┤
  │                              │
  │  Gas Used Distribution       │
  │  ┌──────────────────────┐   │
  │  │  ▄▄████▄▄░░          │   │   ← Mini histogram
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

### 2D Overlay (Selalu Tampil)

Di samping/atas canvas 3D, ada overlay dashboard:

- **Stats bar** — gas price sekarang, TPS, block number, avg fee
- **Tabel sortable** — 12 baris (semua tipe), bisa sort by gas/price/volume
- **Transaction feed** — scrolling list transaksi terbaru real-time
- **Legend** — arti warna dan ukuran

Interaksi **dua arah**: hover bangunan 3D → highlight row di tabel. Hover row di tabel → glow bangunan 3D.

---

## 3 Contoh Skenario Nyata

### Skenario 1 — Hari biasa, network santai

> ☀️ Langit cerah biru. Bangunan pendek-pendek, semua hijau. Partikel jarang muncul. Sungai mengalir pelan.
>
> _Artinya: gas murah, aktivitas rendah, waktu bagus untuk deploy kontrak atau bridging._

### Skenario 2 — Memecoin launch, semua orang swap

> 🌅 Langit mulai oranye. Bangunan **"SWAP"** tiba-tiba menjulang tinggi dan berubah kuning → merah, partikel kuning emas membanjir dari atasnya. Bangunan lain masih pendek hijau.
>
> _Artinya: swap mahal karena congestion di DEX, tapi transfer biasa masih murah. Hindari swap, tunggu reda._

### Skenario 3 — Bridge rush, likuiditas masuk/keluar

> 🌤️ Bangunan **"BRIDGE DEPOSIT"** dan **"BRIDGE WITHDRAW"** tumbuh tinggi, partikel ungu beterbangan. Sungai data mengalir cepat.
>
> _Artinya: banyak orang memindahkan aset antara L1 Ethereum dan Robinhood Chain. Perhatikan slippage bridge._

---

## Alur Teknis (Simplified)

```
Setiap 3 detik:

  Robinhood RPC ──► ambil block terbaru
       │
       ▼
  Ada 15 transaksi ──► parse calldata masing-masing
       │
       ▼
  Klasifikasi: 8 swap, 3 transfer, 2 approve, 1 bridge, 1 mint
       │
       ▼
  Hitung: swap avgGas = 180K, transfer avgGas = 21K, dst
       │
       ▼
  Update Zustand store
       │
       ├──► Bangunan "SWAP" tumbuh sedikit, 8 partikel kuning muncul
       ├──► Bangunan "TRANSFER" stabil, 3 partikel biru kecil
       ├──► Langit tetap cerah (network masih santai)
       ├──► Sungai tetap mengalir pelan
       ├──► Dashboard angka update
       └──► Feed scroll: 15 tx baru muncul di list
```

---

## Ringkasan

**GasHood mengubah data gas fee yang biasanya cuma angka di explorer menjadi pengalaman visual intuitif** — kamu "merasakan" kondisi blockchain Robinhood Chain seperti merasakan cuaca di kota, bukan membaca tabel cuaca.

- 🏙️ **Kota** = keseluruhan Robinhood Chain
- 🏢 **Bangunan** = tipe transaksi (12 jenis)
- 📏 **Tinggi bangunan** = gas yang dipakai
- 🎨 **Warna bangunan** = harga gas (hijau murah, merah mahal)
- ✨ **Partikel** = transaksi individual masuk
- 🌊 **Sungai** = throughput network
- 🌤️ **Langit** = kesehatan keseluruhan network
