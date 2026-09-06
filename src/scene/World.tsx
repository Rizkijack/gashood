import { type ReactNode, Component, Suspense, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, SSAO, Noise } from '@react-three/postprocessing'
import { GasParticles } from './GasParticles'
import { DataRiver } from './DataRiver'
import { SkyDome } from './SkyDome'
import { Vegetation } from './Vegetation'
import { RooftopDetails } from './BuildingFacade'
import { RoadNetwork } from './RoadNetwork'
import { Traffic } from './Traffic'
import { SkyObjects } from './SkyObjects'
import { Airplane } from './Airplane'
import { Birds } from './Birds'
import { CITY_SCALE, RIVER_Z } from './layout'

class EnvironmentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

interface WorldProps {
  children?: ReactNode
}

/* ---- TANAH (AC rekonstruksi, ≤8 draw calls) -------------------------------
 * Detail statis dihitung sekali di module scope — bukan per render.
 * gridHelper dihapus — diganti plaza + sidewalk + jalan yang nyata.
 * Rescale ×CITY_SCALE: seluruh SPAN kota (ground/plaza/posisi strip) ikut
 * CITY_SCALE; lebar strip sidewalk (0.5) & jalan (1.6) TETAP — skala pejalan
 * kaki/kendaraan. */

const PLAZA_SIZE = 26 * CITY_SCALE; // 390 — memayungi grid bangunan ±105
const SIDEWALK_W = 0.5; // Tetap — lebar trotoar skala pejalan kaki (~1.7 m)

/* Offset-y lapisan ×CITY_SCALE — offset mikrometer (0.004) lenyap di depth
 * buffer 24-bit pada jarak kota (ambang Δz ≈ 0.008 @ jarak 370, 0.021 @ 600
 * dengan near=1) → z-fighting. Dengan near=2 (App.tsx) ambang melar jadi
 * ≈ 0.004 @ 370, 0.011 @ 600. Urutan relatif TETAP seperti semula:
 *   base(0) < sidewalk X < sidewalk Z ≤ plaza < road < lapisan RoadNetwork
 * (sidewalk Z & plaza bersentuhan tepi saja — tidak overlap, aman se-slope). */
const SIDEWALK_X_Y = 0.004 * CITY_SCALE; // 0.06
const SIDEWALK_Z_Y = 0.005 * CITY_SCALE; // 0.075
const PLAZA_Y = 0.005 * CITY_SCALE; // 0.075
const ROAD_Y = 0.008 * CITY_SCALE; // 0.12

// Sidewalk: 4 strip mengelilingi plaza (flush di tepi plaza, menyembul keluar
// setengah lebar). Strip X & Z saling overlap di 4 pojok — diberi y berbeda
// (SIDEWALK_X_Y/SIDEWALK_Z_Y, selisih 0.015) agar tidak z-fight di pojok.
const SIDEWALK_STRIPS: { x: number; z: number; y: number; size: [number, number] }[] = [
  { x: 0, z: PLAZA_SIZE / 2 + SIDEWALK_W / 2, y: SIDEWALK_X_Y, size: [PLAZA_SIZE + 2 * SIDEWALK_W, SIDEWALK_W] },
  { x: 0, z: -(PLAZA_SIZE / 2 + SIDEWALK_W / 2), y: SIDEWALK_X_Y, size: [PLAZA_SIZE + 2 * SIDEWALK_W, SIDEWALK_W] },
  { x: PLAZA_SIZE / 2 + SIDEWALK_W / 2, z: 0, y: SIDEWALK_Z_Y, size: [SIDEWALK_W, PLAZA_SIZE + 2 * SIDEWALK_W] },
  { x: -(PLAZA_SIZE / 2 + SIDEWALK_W / 2), z: 0, y: SIDEWALK_Z_Y, size: [SIDEWALK_W, PLAZA_SIZE + 2 * SIDEWALK_W] },
];

// Jalan tipis: 1 strip sejajar sumbu X di koridor antara baris z=-SPACING dan
// z=0 (z=-RIVER_Z). Lebar TETAP 1.6 (skala mobil, menyambung dengan ring
// avenue RoadNetwork) — koridor z=+RIVER_Z dipakai sungai DataRiver.
const ROAD_STRIPS: { z: number; size: [number, number] }[] = [
  { z: -RIVER_Z, size: [PLAZA_SIZE, 1.6] },
];

/* ---- Tekstur prosedural tanah (realisme, Ethereal Glass) -------------------
 * SEMUA CanvasTexture dibuat SEKALI dan di-cache module-scope (Map, ≤10 entri)
 * — zero alokasi per render/frame. Albedo = sRGB; roughnessMap = linear.
 * RepeatWrapping; blotch besar digambar wrapped 3×3 agar tile mulus tanpa
 * seam. Anisotropy di-set dari gl.capabilities saat World mount (sebelum
 * upload pertama — lihat applyGroundAnisotropy). Struktur layer/y-offset
 * TIDAK diubah (baru difix z-fighting) — hanya material/texture.
 * --------------------------------------------------------------------------- */

/** PRNG deterministik mulberry32 (pola sama dengan Vegetation/BuildingFacade). */
function mulberryGround(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const groundTextureCache = new Map<string, THREE.CanvasTexture>();

function makeGroundCanvas(w: number, h: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia");
  return { canvas, ctx };
}

/** Blotch radial SOFT yang tileable — digambar 3×3 offset wrap supaya tepi
 * tile tersambung (tanpa seam di repeat). */
function wrappedBlotch(
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  r: number,
  cr: number,
  cg: number,
  cb: number,
  alpha: number,
): void {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      const cx = x + ox * size;
      const cy = y + oz * size;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
}

/** Cache + konfigurasi tekstur tanah (repeat di-set di sini, anisotropy belakangan). */
function groundTexture(
  key: string,
  build: () => HTMLCanvasElement,
  repeatX: number,
  repeatY: number,
  srgb: boolean,
): THREE.CanvasTexture {
  const cached = groundTextureCache.get(key);
  if (cached) return cached;
  const tex = new THREE.CanvasTexture(build());
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  groundTextureCache.set(key, tex);
  return tex;
}

/** Set anisotropy semua tekstur tanah dari gl.capabilities — dipanggil SEKALI
 * di useLayoutEffect World (sebelum upload pertama, jadi tanpa re-upload). */
function applyGroundAnisotropy(maxAniso: number): void {
  for (const tex of groundTextureCache.values()) {
    tex.anisotropy = maxAniso;
    tex.needsUpdate = true;
  }
}

/* -- 1. Rumput 600²: noise hijau-gelap 2-oktaf + blotch besar halus --------- */
function buildGrassCanvas(): HTMLCanvasElement {
  const S = 256;
  const { canvas, ctx } = makeGroundCanvas(S, S);
  const rnd = mulberryGround(101);
  ctx.fillStyle = "#1a2418";
  ctx.fillRect(0, 0, S, S);
  // Oktaf 1 — blotch besar halus (penumbingusan organik, tileable).
  for (let i = 0; i < 26; i++) {
    const dark = rnd() < 0.5;
    wrappedBlotch(ctx, S, rnd() * S, rnd() * S, 26 + rnd() * 62,
      dark ? 10 : 32, dark ? 20 : 42, dark ? 11 : 22, 0.05 + rnd() * 0.09);
  }
  // Oktaf 2 — grain rumput halus (spesifikasi gelap/terang tipis).
  for (let i = 0; i < 1500; i++) {
    const dark = rnd() < 0.55;
    ctx.fillStyle = dark
      ? `rgba(8,14,8,${0.05 + rnd() * 0.08})`
      : `rgba(46,66,32,${0.04 + rnd() * 0.07})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 3);
  }
  return canvas;
}

function getGrassTexture(): THREE.CanvasTexture {
  // Tile ~30 unit → repeat 20 untuk ground 600².
  return groundTexture("grass", buildGrassCanvas, 20, 20, true);
}

/* -- 2. Plaza aspal 390²: noise halus + patchy wear + roughnessMap ---------- */
function buildPlazaCanvas(): HTMLCanvasElement {
  const S = 256;
  const { canvas, ctx } = makeGroundCanvas(S, S);
  const rnd = mulberryGround(202);
  ctx.fillStyle = "#1b1d23";
  ctx.fillRect(0, 0, S, S);
  // Patchy wear: baret gelap besar + beberapa scuff lebih terang (wrap).
  for (let i = 0; i < 10; i++) {
    wrappedBlotch(ctx, S, rnd() * S, rnd() * S, 20 + rnd() * 50, 9, 10, 13, 0.06 + rnd() * 0.07);
  }
  for (let i = 0; i < 6; i++) {
    wrappedBlotch(ctx, S, rnd() * S, rnd() * S, 14 + rnd() * 30, 36, 38, 44, 0.04 + rnd() * 0.05);
  }
  // Grain aspal halus.
  for (let i = 0; i < 1400; i++) {
    const v = 18 + Math.floor(rnd() * 22);
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.05 + rnd() * 0.09})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return canvas;
}

function getPlazaTexture(): THREE.CanvasTexture {
  // Tile ~48 unit → repeat 8 untuk plaza 390².
  return groundTexture("plaza", buildPlazaCanvas, 8, 8, true);
}

/** RoughnessMap plaza (linear): base ~0.93 dgn patch wear lebih licin. */
function buildPlazaRoughnessCanvas(): HTMLCanvasElement {
  const S = 128;
  const { canvas, ctx } = makeGroundCanvas(S, S);
  const rnd = mulberryGround(303);
  ctx.fillStyle = "rgb(237,237,237)";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) {
    const v = 200 + Math.floor(rnd() * 22);
    wrappedBlotch(ctx, S, rnd() * S, rnd() * S, 16 + rnd() * 40, v, v, v, 0.12 + rnd() * 0.15);
  }
  for (let i = 0; i < 700; i++) {
    const v = 222 + Math.floor(rnd() * 28);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.2 + rnd() * 0.25})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return canvas;
}

function getPlazaRoughnessTexture(): THREE.CanvasTexture {
  return groundTexture("plaza-rough", buildPlazaRoughnessCanvas, 8, 8, false);
}

/* -- 3. Sidewalk: ubin beton + groove hairline (1px gelap per tile) --------- */
/** Canvas 512×64 merepresentasikan 8 unit panjang × lebar strip; groove vertikal
 * tiap 64px (tiap 1 unit) + garis tepi/tengah sepanjang strip. */
function buildSidewalkCanvas(): HTMLCanvasElement {
  const W = 512;
  const H = 64;
  const { canvas, ctx } = makeGroundCanvas(W, H);
  const rnd = mulberryGround(404);
  ctx.fillStyle = "#2a2c33";
  ctx.fillRect(0, 0, W, H);
  // Jitter brightness per tile (kolom 64px) — beton bukan warna seragam.
  for (let c = 0; c < 8; c++) {
    const a = (rnd() - 0.5) * 0.07;
    ctx.fillStyle = a >= 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
    ctx.fillRect(c * 64, 0, 64, H);
  }
  // Grain beton halus.
  for (let i = 0; i < 900; i++) {
    const v = 30 + Math.floor(rnd() * 26);
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.06 + rnd() * 0.08})`;
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // Groove hairline — expansion joint tiap 1 unit (vertikal = across width).
  ctx.fillStyle = "rgba(12,13,17,0.85)";
  for (let x = 0; x <= W; x += 64) ctx.fillRect(Math.min(x, W - 1), 0, 1, H);
  // Garis tepi (curb) + groove tengah sepanjang strip.
  ctx.fillRect(0, 0, W, 1);
  ctx.fillRect(0, H - 1, W, 1);
  ctx.fillStyle = "rgba(12,13,17,0.5)";
  ctx.fillRect(0, H / 2, W, 1);
  return canvas;
}

function getSidewalkBaseTexture(): THREE.CanvasTexture {
  return groundTexture("sidewalk", buildSidewalkCanvas, 1, 1, true);
}

/** Dua orientasi strip butuh repeat berbeda (panjang ada di sumbu berbeda).
 * clone() berbagi canvas sumber — hanya repeat-nya yang beda; keduanya cached. */
function getSidewalkXTexture(): THREE.CanvasTexture {
  const cached = groundTextureCache.get("sidewalk-x");
  if (cached) return cached;
  const clone = getSidewalkBaseTexture().clone();
  clone.repeat.set((PLAZA_SIZE + 2 * SIDEWALK_W) / 8, 1);
  groundTextureCache.set("sidewalk-x", clone);
  return clone;
}

function getSidewalkZTexture(): THREE.CanvasTexture {
  const cached = groundTextureCache.get("sidewalk-z");
  if (cached) return cached;
  const clone = getSidewalkBaseTexture().clone();
  clone.repeat.set(1, (PLAZA_SIZE + 2 * SIDEWALK_W) / 8);
  groundTextureCache.set("sidewalk-z", clone);
  return clone;
}

/* -- 4. Jalan (strip di World): aspal lebih gelap + noise ------------------- */
function buildRoadCanvas(): HTMLCanvasElement {
  const S = 256;
  const { canvas, ctx } = makeGroundCanvas(S, S);
  const rnd = mulberryGround(505);
  ctx.fillStyle = "#1d2026";
  ctx.fillRect(0, 0, S, S);
  // Streak wear searah lajur (horizontal) — sangat halus.
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.05})`;
    ctx.fillRect(0, rnd() * S, S, 2 + rnd() * 8);
  }
  // Grain + agregat.
  for (let i = 0; i < 1200; i++) {
    const v = 20 + Math.floor(rnd() * 20);
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 7},${0.05 + rnd() * 0.09})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(58,62,70,${0.1 + rnd() * 0.12})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return canvas;
}

function getRoadTexture(): THREE.CanvasTexture {
  // Tile 4×0.8 unit untuk strip [390, 1.6].
  return groundTexture("road", buildRoadCanvas, PLAZA_SIZE / 4, 2, true);
}

/**
 * L28 (responsive): DataRiver disembunyikan di viewport < 768px demi performa —
 * shader full-width + fragment cost-nya terlalu berat untuk GPU mobile.
 * Ukuran dibaca dari useThree agar reaktif terhadap resize/orientasi.
 */
function ResponsiveDataRiver() {
  const width = useThree((state) => state.size.width)
  if (width < 768) return null
  return <DataRiver />
}

/** Threshold desktop untuk post-processing (SSAO + NormalPass + film grain). */
const DESKTOP_MIN_POST_WIDTH = 1024

/**
 * Post desktop-only (pola gate ResponsiveDataRiver): SSAO + film grain halus
 * (Ethereal Glass) HANYA di viewport ≥1024px. Mobile beban tidak bertambah —
 * termasuk NormalPass, karena EffectComposer men-set enableNormalPass dengan
 * threshold yang sama (wrapper SSAO melempar error tanpa NormalPass).
 * Scan group EffectComposer berjalan tiap commit → mount/unmount saat resize
 * otomatis terdeteksi (verified di dist @react-three/postprocessing v3).
 */
function DesktopEffects() {
  const width = useThree((state) => state.size.width)
  if (width < DESKTOP_MIN_POST_WIDTH) return null
  return (
    <>
      {/* SSAO restrained: samples ~24, radius kecil (relative-resolution),
          intensity rendah — contact-shadow halus di kaki gedung/tepi plaza. */}
      <SSAO
        samples={24}
        rings={5}
        radius={0.1}
        bias={0.025}
        intensity={1.6}
        luminanceInfluence={0.6}
      />
      {/* Film grain halus: premultiply + opacity 0.025 — tekstur analogis,
          bukan noise kasar. Bloom/Vignette TIDAK diubah parameternya. */}
      <Noise premultiply opacity={0.025} />
    </>
  )
}

export function World({ children }: WorldProps) {
  // Anisotropy tekstur tanah dari capabilities GPU — sekali saat mount
  // (useLayoutEffect berjalan sebelum render frame pertama → tanpa re-upload).
  const gl = useThree((state) => state.gl)
  useLayoutEffect(() => {
    applyGroundAnisotropy(Math.min(8, gl.capabilities.getMaxAnisotropy()))
  }, [gl])

  // Gate NormalPass SSAO — threshold SAMA dengan <DesktopEffects /> agar
  // mobile/tablet tidak membayar render normal tambahan per frame.
  const viewportWidth = useThree((state) => state.size.width)
  const enableNormalPass = viewportWidth >= DESKTOP_MIN_POST_WIDTH

  return (
    <>
      <fog attach="fog" args={['#0a0a0f', 20 * CITY_SCALE, 50 * CITY_SCALE]} />

      <ambientLight intensity={0.4} />
      {/* Fill langit-tanah lembut (realisme anti-flat): hemisphere restrained
          sejalan palet OLED — sky kebiruan gelap, ground nyaris hitam. */}
      <hemisphereLight color="#1e2633" groundColor="#0a0a0f" intensity={0.35} />
      <directionalLight
        intensity={0.8}
        position={[10 * CITY_SCALE, 15 * CITY_SCALE, 5 * CITY_SCALE]}
        castShadow
        // Rescale ×CITY_SCALE: shadow camera harus membingkai kota ±300
        // (grid ±105 + ring pohon ±285). mapSize 1024→2048 menahan ketajaman
        // di span 15× — trade-off fill-rate GPU ~4× per pass shadow.
        // Catatan: shadow-radius TIDAK di-set — tidak didukung PCFSoft
        // (shadows="soft" di App.tsx punya kernel blur tetap sendiri).
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5 * CITY_SCALE}
        shadow-camera-far={50 * CITY_SCALE}
        shadow-camera-left={-20 * CITY_SCALE}
        shadow-camera-right={20 * CITY_SCALE}
        shadow-camera-top={20 * CITY_SCALE}
        shadow-camera-bottom={-20 * CITY_SCALE}
      />
      {/* Point light aksen: posisi ×CITY_SCALE; intensity ×CITY_SCALE² untuk
          mengompensasi decay fisik 1/r² agar kontribusi visual tetap sama. */}
      <pointLight position={[-8 * CITY_SCALE, 5 * CITY_SCALE, -8 * CITY_SCALE]} intensity={0.3 * CITY_SCALE * CITY_SCALE} color="#4488ff" />
      <pointLight position={[8 * CITY_SCALE, 5 * CITY_SCALE, 8 * CITY_SCALE]} intensity={0.2 * CITY_SCALE * CITY_SCALE} color="#ff8844" />

      {/*
        TANAH rekonstruksi (≤8 draw calls), span ×CITY_SCALE — material kini
        bertekstur prosedural (cache module-scope, anisotropy dari gl caps):
        1. Base 600×600 rumput: CanvasTexture noise hijau 2-oktaf + blotch
        2. Plaza aspal 390×390: noise + wear patch + roughnessMap
        3. Sidewalk ring — 4 strip 0.5 dengan groove hairline per tile ubin
        4. 1 strip jalan tipis di koridor z=-RIVER_Z (aspal gelap + noise)
        Struktur layer/y-offset TIDAK diubah (baru difix z-fighting); semua
        lapisan tetap receiveShadow. color putih — warna berasal dari map.
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40 * CITY_SCALE, 40 * CITY_SCALE]} />
        <meshStandardMaterial map={getGrassTexture()} color="#ffffff" roughness={1} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, PLAZA_Y, 0]} receiveShadow>
        <planeGeometry args={[PLAZA_SIZE, PLAZA_SIZE]} />
        <meshStandardMaterial
          map={getPlazaTexture()}
          roughnessMap={getPlazaRoughnessTexture()}
          color="#ffffff"
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Sidewalk ring — 4 strip tipis (draw call 3–6); y SIDEWALK_X_Y/SIDEWALK_Z_Y
          alternate agar pojok yang overlap tidak z-fight; tekstur ubin beton
          di-clone per orientasi (repeat sepanjang strip) — cache module-scope */}
      {SIDEWALK_STRIPS.map((s) => {
        const alongX = s.size[0] > s.size[1]
        return (
          <mesh
            key={`sidewalk-${s.x}-${s.z}`}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[s.x, s.y, s.z]}
            receiveShadow
          >
            <planeGeometry args={s.size} />
            <meshStandardMaterial
              map={alongX ? getSidewalkXTexture() : getSidewalkZTexture()}
              color="#ffffff"
              roughness={0.92}
              metalness={0}
            />
          </mesh>
        )
      })}

      {/* Jalan tipis — 1 strip sejajar x (draw call 7); aspal lebih gelap + noise */}
      {ROAD_STRIPS.map((r) => (
        <mesh
          key={`road-${r.z}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, ROAD_Y, r.z]}
          receiveShadow
        >
          <planeGeometry args={r.size} />
          <meshStandardMaterial map={getRoadTexture()} color="#ffffff" roughness={0.9} metalness={0} />
        </mesh>
      ))}

      {/* Vegetasi statis: rumput + pohon perimeter — InstancedMesh, 4 draw calls */}
      <Vegetation />

      {/* Detail rooftop global (AC/antena/water tower) — 1 InstancedMesh per
          jenis untuk SELURUH kota; posisi mengikuti tower yang di-lerp via
          registry live-state di BuildingFacade. */}
      <RooftopDetails />

      {/*
        Jaringan jalan raya + lalu-lalang mobil (kota hidup mengikuti TPS).
        Diletakkan terpisah (bukan di dalam EnvironmentBoundary) agar gagal
        preload env tidak mematikan jalan/mobil.
      */}
      <RoadNetwork />
      <Traffic />

      <EnvironmentBoundary>
        <Suspense fallback={null}>
          <Environment preset="city" />
        </Suspense>
      </EnvironmentBoundary>

      {children}

      <GasParticles />
      <ResponsiveDataRiver />
      <SkyDome />
      <SkyObjects />
      <Airplane />
      <Birds />

      {/* multisampling 2 (default 8x terlalu berat untuk mid-range @ dpr tinggi).
          enableNormalPass hanya desktop ≥1024px (kebutuhan wrapper SSAO +
          <DesktopEffects />); mobile = Bloom+Vignette saja seperti sebelumnya. */}
      <EffectComposer multisampling={2} enableNormalPass={enableNormalPass}>
        <Bloom
          luminanceThreshold={0.8}
          luminanceSmoothing={0.9}
          intensity={0.5}
        />
        <Vignette offset={0.3} darkness={0.5} />
        <DesktopEffects />
      </EffectComposer>
    </>
  )
}
