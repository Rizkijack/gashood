import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { TxType } from "@/data/tx-classifier";
import { getBuildingPosition, TX_TYPES_ORDERED } from "./layout";

/* ---------------------------------------------------------------------------
 * BuildingFacade — fasad & detail rooftop prosedural untuk GasBuilding.
 *
 * Tujuan: 12 bangunan kota tampak seperti gedung dunia nyata (stylized-
 * realistic) TANPA mengubah semantik data:
 *   - Tinggi tower tetap = avgGasUsed (lerp 0.05/useFrame di GasBuilding)
 *   - Lebar tetap = recentTxCount
 *   - Warna/emissive tetap = bracket avgGasPrice + pulse + hover/selected
 *
 * Isi modul:
 *   1. 3 arketipe arsitektur dipetakan deterministik per TxType:
 *      glass    — menara kaca modern (tirai kaca reflektif + spandel tipis)
 *      concrete — mid-rise beton, jendela rulek + garis lantai/balcony
 *      setback  — menara korporat 3 stack yang mengecil ke atas
 *   2. CanvasTexture albedo + emissive per TxType (dibuat SEKALI, di-cache);
 *      jendela menyala hangat acak via mulberry32 (seed per TxType).
 *   3. Geometri tower = merge stack box (setback = 3 stack) — SATU mesh per
 *      tower → tetap 1 draw call. UV di-scale per stack agar modul jendela
 *      konsisten antar stack (baris lantai sejajar dunia).
 *   4. Podium/lobby ~2 lantai (batu gelap + kaca pintu masuk menyala).
 *   5. RooftopDetails — InstancedMesh GLOBAL (3 draw call untuk SELURUH kota):
 *      unit AC, antena/beacon, water tower. Mengikuti animasi lerp tinggi
 *      tower lewat registry live-state yang GasBuilding tulis tiap frame
 *      (nol alokasi per frame).
 *
 * Draw call per bangunan: tower(1) + podium(1) + cap atap(1) = 3 (sama
 * dengan implementasi lama: body+plinth+roof). Detail rooftop: +3 GLOBAL.
 * ------------------------------------------------------------------------- */

/** PRNG deterministik mulberry32 (pola sama dengan Vegetation). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function txTypeIndex(txType: TxType): number {
  const i = TX_TYPES_ORDERED.indexOf(txType);
  return i === -1 ? 0 : i;
}

/* ==== 1. Arketipe arsitektur ============================================== */

export type FacadeArchetype = "glass" | "concrete" | "setback";

/** Stack tower dalam ruang bangunan unit (footprint 1×1, tinggi y ∈ [0,1]). */
interface StackSpec {
  w: number;
  y0: number;
  y1: number;
}

interface ArchetypeDef {
  stacks: StackSpec[];
  tileCols: number; // kolom jendela per tile tekstur
  tileRows: number; // baris lantai per tile tekstur
  floorsTotal: number; // jumlah lantai nominal bangunan (skala UV)
  litRatio: number; // fraksi jendela menyala
  metalness: number;
  roughness: number;
  envMapIntensity: number;
}

const ARCHETYPES: Record<FacadeArchetype, ArchetypeDef> = {
  // (a) Menara kaca modern — tirai kaca penuh, mullion tipis, reflektif.
  glass: {
    stacks: [{ w: 1, y0: 0, y1: 1 }],
    tileCols: 6,
    tileRows: 8,
    floorsTotal: 16,
    litRatio: 0.3,
    metalness: 0.6,
    roughness: 0.22,
    envMapIntensity: 1.0,
  },
  // (b) Mid-rise beton — jendela rulek kecil, dinding terekspos, garis lantai.
  concrete: {
    stacks: [{ w: 1, y0: 0, y1: 1 }],
    tileCols: 5,
    tileRows: 6,
    floorsTotal: 12,
    litRatio: 0.22,
    metalness: 0.08,
    roughness: 0.78,
    envMapIntensity: 0.4,
  },
  // (c) Menara setback — 3 stack mengecil ke atas (gaya korporat 70-an).
  setback: {
    stacks: [
      { w: 1, y0: 0, y1: 0.55 },
      { w: 0.78, y0: 0.55, y1: 0.82 },
      { w: 0.56, y0: 0.82, y1: 1 },
    ],
    tileCols: 5,
    tileRows: 6,
    floorsTotal: 12,
    litRatio: 0.26,
    metalness: 0.45,
    roughness: 0.4,
    envMapIntensity: 0.7,
  },
};

/** Pemetaan deterministik TxType → arketipe (variasi antar tetangga grid). */
const ARCHETYPE_BY_TYPE: Record<TxType, FacadeArchetype> = {
  native_transfer: "concrete",
  erc20_transfer: "glass",
  erc20_approve: "concrete",
  dex_swap: "glass",
  liquidity: "setback",
  bridge_deposit: "setback",
  bridge_withdraw: "setback",
  nft_transfer: "concrete",
  nft_mint: "glass",
  contract_deploy: "setback",
  contract_call: "glass",
  rwa_token: "glass",
};

export function getFacadeArchetype(txType: TxType): FacadeArchetype {
  return ARCHETYPE_BY_TYPE[txType];
}

export interface FacadeMaterialParams {
  metalness: number;
  roughness: number;
  envMapIntensity: number;
}

export function getFacadeMaterialParams(txType: TxType): FacadeMaterialParams {
  const def = ARCHETYPES[getFacadeArchetype(txType)];
  return {
    metalness: def.metalness,
    roughness: def.roughness,
    envMapIntensity: def.envMapIntensity,
  };
}

/** Lebar stack teratas (untuk cap atap & penempatan detail rooftop). */
export function getTopStackWidth(txType: TxType): number {
  const stacks = ARCHETYPES[getFacadeArchetype(txType)].stacks;
  return stacks[stacks.length - 1].w;
}

/* ==== 2. Tekstur fasad (albedo + emissive, cache per TxType) ============== */

export interface FacadeTextureSet {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

const TILE_SIZE = 256;

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia");
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

/** Jendela menyala: digambar ke albedo (kaca terang) + emissive (glow hangat). */
function drawLitWindow(
  albedo: CanvasRenderingContext2D,
  emissive: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
): void {
  const bright = 0.5 + rnd() * 0.5;
  const warm = rnd() < 0.78;
  // Albedo — kaca menyala tampak terang meski emissive intensity rendah.
  albedo.fillStyle = warm
    ? `rgba(255,214,150,${0.55 + bright * 0.3})`
    : `rgba(205,220,255,${0.5 + bright * 0.3})`;
  albedo.fillRect(x, y, w, h);
  // Emissive — hitam di area mati, hangat di area menyala (× warna bracket).
  emissive.fillStyle = warm
    ? `rgba(255,196,120,${bright})`
    : `rgba(170,200,255,${bright * 0.8})`;
  emissive.fillRect(x, y, w, h);
}

function buildFacadeTextureSet(arch: FacadeArchetype, rnd: () => number): FacadeTextureSet {
  const albedo = makeCanvas(TILE_SIZE);
  const emissive = makeCanvas(TILE_SIZE);
  const a = albedo.ctx;
  const e = emissive.ctx;
  const def = ARCHETYPES[arch];
  const rowH = TILE_SIZE / def.tileRows;
  const colW = TILE_SIZE / def.tileCols;

  // Emissive mulai hitam total (dinding tidak memancarkan cahaya).
  e.fillStyle = "#000000";
  e.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  if (arch === "glass") {
    // Dinding/spandel abu terang — warna bracket bangunan terlihat via tint.
    a.fillStyle = "#8a919b";
    a.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let r = 0; r < def.tileRows; r++) {
      const y0 = r * rowH;
      // Spandel tipis di bawah tiap lantai (balcony line).
      a.fillStyle = "#6f7681";
      a.fillRect(0, y0 + rowH * 0.8, TILE_SIZE, rowH * 0.2 + 1);
      for (let c = 0; c < def.tileCols; c++) {
        const x = c * colW + 2;
        const y = y0 + 2;
        const w = colW - 4;
        const h = rowH * 0.8 - 5;
        // Kaca biru gelap dengan pantulan langit di atas pane.
        const g = a.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, "#253a50");
        g.addColorStop(0.5, "#111b27");
        g.addColorStop(1, "#0b1119");
        a.fillStyle = g;
        a.fillRect(x, y, w, h);
        a.fillStyle = "rgba(150,185,220,0.2)";
        a.fillRect(x, y, w, h * 0.16);
        if (rnd() < def.litRatio) drawLitWindow(a, e, x, y, w, h, rnd);
      }
    }
  } else if (arch === "concrete") {
    // Beton krem dengan noise halus (tekstur presisi kayu/beton).
    a.fillStyle = "#b1a795";
    a.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < 80; i++) {
      a.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.05})`;
      a.fillRect(rnd() * TILE_SIZE, rnd() * TILE_SIZE, 3 + rnd() * 12, 1 + rnd() * 3);
    }
    for (let r = 0; r < def.tileRows; r++) {
      const y0 = r * rowH;
      // Garis lantai/balcony tipis.
      a.fillStyle = "#95897a";
      a.fillRect(0, y0 + rowH * 0.8, TILE_SIZE, 2.5);
      for (let c = 0; c < def.tileCols; c++) {
        // Jendela rulek — hanya ~50% lebar sel, sisanya dinding terekspos.
        const x = c * colW + colW * 0.25;
        const y = y0 + rowH * 0.16;
        const w = colW * 0.5;
        const h = rowH * 0.52;
        const g = a.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, "#1e2b38");
        g.addColorStop(1, "#0e161f");
        a.fillStyle = g;
        a.fillRect(x, y, w, h);
        a.fillStyle = "rgba(165,195,225,0.28)";
        a.fillRect(x, y, w, h * 0.35);
        // Ambang jendela.
        a.fillStyle = "#8b8172";
        a.fillRect(x - 2, y + h, w + 4, 3);
        if (rnd() < def.litRatio) drawLitWindow(a, e, x, y, w, h, rnd);
      }
    }
  } else {
    // setback — ribbon kaca kontinu + spandel tebal + pilaster vertikal.
    a.fillStyle = "#7a8089";
    a.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let r = 0; r < def.tileRows; r++) {
      const y0 = r * rowH;
      a.fillStyle = "#61666d";
      a.fillRect(0, y0 + rowH * 0.68, TILE_SIZE, rowH * 0.32 + 1);
      const y = y0 + rowH * 0.12;
      const h = rowH * 0.5;
      const g = a.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, "#1d2a37");
      g.addColorStop(1, "#0d141c");
      a.fillStyle = g;
      a.fillRect(2, y, TILE_SIZE - 4, h);
      a.fillStyle = "rgba(150,180,215,0.2)";
      a.fillRect(2, y, TILE_SIZE - 4, h * 0.3);
      for (let c = 0; c < def.tileCols; c++) {
        const x = c * colW + 2.5;
        const w = colW - 5;
        if (rnd() < def.litRatio) drawLitWindow(a, e, x, y + 1.5, w, h - 3, rnd);
        // Pilaster memecah ribbon (digambar terakhir agar di atas kaca).
        a.fillStyle = "#6d737b";
        a.fillRect(c * colW - 1.5, y, 3, h);
      }
    }
  }

  return {
    map: toTexture(albedo.canvas, true),
    emissiveMap: toTexture(emissive.canvas, true),
  };
}

/** Cache tekstur fasad — dibuat SEKALI per TxType (bukan per render). */
const facadeTextureCache = new Map<TxType, FacadeTextureSet>();

export function getFacadeTextures(txType: TxType): FacadeTextureSet {
  const cached = facadeTextureCache.get(txType);
  if (cached) return cached;
  const arch = getFacadeArchetype(txType);
  const rnd = mulberry32(1000 + txTypeIndex(txType) * 127);
  const set = buildFacadeTextureSet(arch, rnd);
  facadeTextureCache.set(txType, set);
  return set;
}

/* ==== 3. Geometri tower (merge stack, 1 draw call) ======================== */

/** Gabung beberapa BoxGeometry (atribut identik) jadi satu BufferGeometry. */
function mergeBoxGeometries(geometries: THREE.BoxGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geometries) {
    vCount += g.attributes.position.count;
    iCount += g.index!.count;
  }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const indices = new Uint16Array(iCount);
  let vBase = 0;
  let iBase = 0;
  for (const g of geometries) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    positions.set(pos.array as Float32Array, vBase * 3);
    normals.set(nor.array as Float32Array, vBase * 3);
    uvs.set(uv.array as Float32Array, vBase * 2);
    for (let i = 0; i < g.index!.count; i++) {
      indices[iBase + i] = g.index!.getX(i) + vBase;
    }
    vBase += pos.count;
    iBase += g.index!.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

const towerGeometryCache = new Map<TxType, THREE.BufferGeometry>();

/**
 * Tower utuh (semua stack setback) sebagai SATU geometri, ruang lokal
 * y ∈ [-0.5, 0.5] — konsisten dengan body unit lama (group origin = dasar).
 * UV samping di-scale per stack: baris jendela tetap sejajar antar stack
 * (v = tinggi bangunan × K), mullion horizontal konsisten (u = lebar × K).
 * UV atap/dasar disembunyikan ke sample spandel (tidak terlihat — ditutup
 * cap atap / podium).
 */
export function getTowerGeometry(txType: TxType): THREE.BufferGeometry {
  const cached = towerGeometryCache.get(txType);
  if (cached) return cached;

  const arch = getFacadeArchetype(txType);
  const def = ARCHETYPES[arch];
  const k = def.floorsTotal / def.tileRows; // tile vertikal per bangunan

  const parts = def.stacks.map((s) => {
    const g = new THREE.BoxGeometry(s.w, s.y1 - s.y0, s.w);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const uScale = s.w * k;
    const vScale = (s.y1 - s.y0) * k;
    const vOffset = s.y0 * k;
    for (let i = 0; i < uv.count; i++) {
      if (i >= 8 && i < 16) {
        // Vertex face +y/-y (atap & dasar) — sample spandel polos.
        uv.setXY(i, 0.05, 0.02);
        continue;
      }
      uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale + vOffset);
    }
    g.translate(0, (s.y0 + s.y1) / 2 - 0.5, 0);
    return g;
  });

  const merged = mergeBoxGeometries(parts);
  towerGeometryCache.set(txType, merged);
  return merged;
}

/* ==== 4. Podium / lobby =================================================== */

/** Podium 1.12× lebar tower — radius efektif max 1.12 < 1.158 (clearance
 * sungai DataRiver, lihat komentar plinth lama). */
export const PODIUM_WIDTH = 1.12;
/** Tinggi podium dunia (~2 lantai stylized) — tetap, tidak ikut skala tower. */
export const PODIUM_HEIGHT = 0.34;

let podiumTextureSet: FacadeTextureSet | null = null;

/** Batu gelap + pita kaca pintu masuk menyala (lobby tampak "hidup"). */
export function getPodiumTextures(): FacadeTextureSet {
  if (podiumTextureSet) return podiumTextureSet;

  const W = 128;
  const H = 64;
  const albedo = document.createElement("canvas");
  albedo.width = W;
  albedo.height = H;
  const emissiveCanvas = document.createElement("canvas");
  emissiveCanvas.width = W;
  emissiveCanvas.height = H;
  const a = albedo.getContext("2d");
  const e = emissiveCanvas.getContext("2d");
  if (!a || !e) throw new Error("Canvas 2D tidak tersedia");

  // Batu gelap + noise.
  a.fillStyle = "#3d414a";
  a.fillRect(0, 0, W, H);
  for (let i = 0; i < 30; i++) {
    a.fillStyle = `rgba(0,0,0,${0.04 + (i % 3) * 0.02})`;
    a.fillRect((i * 37) % W, (i * 23) % H, 4 + (i % 5) * 3, 1 + (i % 3));
  }

  const gx = 12;
  const gy = 16;
  const gw = W - 24;
  const gh = 34;

  // Kanopi/ledge di atas pintu masuk.
  a.fillStyle = "#4b505a";
  a.fillRect(gx - 4, gy - 5, gw + 8, 5);

  // Kaca pintu masuk — gradasi vertikal terang.
  const g = a.createLinearGradient(0, gy, 0, gy + gh);
  g.addColorStop(0, "#c2d2e0");
  g.addColorStop(1, "#8fa4b5");
  a.fillStyle = g;
  a.fillRect(gx, gy, gw, gh);

  // Mullion pintu (setiap panel).
  const mullions: number[] = [];
  for (let x = gx + 17; x < gx + gw; x += 17) mullions.push(x);
  a.fillStyle = "#2c313a";
  for (const x of mullions) a.fillRect(x, gy, 2, gh);

  // Emissive: lobby menyala hangat, mullion tetap gelap.
  e.fillStyle = "#000000";
  e.fillRect(0, 0, W, H);
  e.fillStyle = "rgba(255,224,170,0.95)";
  e.fillRect(gx, gy, gw, gh);
  e.fillStyle = "rgba(0,0,0,0.9)";
  for (const x of mullions) e.fillRect(x, gy, 2, gh);

  podiumTextureSet = {
    map: toTexture(albedo, false),
    emissiveMap: toTexture(emissiveCanvas, false),
  };
  return podiumTextureSet;
}

let podiumGeometry: THREE.BoxGeometry | null = null;

/** Box unit podium dengan UV atap/dasar diarahkan ke area batu polos. */
export function getPodiumGeometry(): THREE.BoxGeometry {
  if (podiumGeometry) return podiumGeometry;
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.05, 0.05);
  podiumGeometry = g;
  return g;
}

/* ==== 5. Registry live-state + RooftopDetails (instancing global) ========= */

export interface RooftopLiveState {
  /** Tepi atas cap atap dunia (mengikuti lerp/pulse/hover). */
  topY: number;
  /** Setengah lebar stack teratas dunia (batas penempatan detail). */
  halfTopWidth: number;
}

/** Ditulis GasBuilding tiap frame (nol alokasi), dibaca RooftopDetails. */
const rooftopLiveStates = new Map<TxType, RooftopLiveState>();

export function registerRooftopLive(txType: TxType): RooftopLiveState {
  const existing = rooftopLiveStates.get(txType);
  if (existing) return existing;
  const state: RooftopLiveState = { topY: 0, halfTopWidth: 0 };
  rooftopLiveStates.set(txType, state);
  return state;
}

export function unregisterRooftopLive(txType: TxType): void {
  rooftopLiveStates.delete(txType);
}

/* --- Spec detail rooftop (deterministik per TxType) ----------------------- */

interface RooftopInstance {
  /** Offset relatif terhadap setengah-lebar atap (−0.5..0.5). */
  rx: number;
  rz: number;
  /** Ukuran dunia. */
  w: number;
  h: number;
  d: number;
  rotY: number;
}

export interface RooftopDetailSpec {
  txType: TxType;
  x: number;
  z: number;
  ac: RooftopInstance[];
  antenna: RooftopInstance | null;
  tank: RooftopInstance | null;
}

/** Spec deterministik (mulberry32, seed per index TxType) — stabil antar render. */
export function generateRooftopSpecs(): RooftopDetailSpec[] {
  return TX_TYPES_ORDERED.map((txType, index) => {
    const rnd = mulberry32(9000 + index * 127);
    const [x, , z] = getBuildingPosition(txType);

    // 1–3 unit AC di 4 kuadran atap, jitter deterministik.
    const acCount = 1 + Math.floor(rnd() * 3);
    const ac: RooftopInstance[] = [];
    for (let i = 0; i < acCount; i++) {
      const qx = i % 2 === 0 ? -1 : 1;
      const qz = i < 2 ? -1 : 1;
      ac.push({
        rx: qx * (0.24 + rnd() * 0.12),
        rz: qz * (0.24 + rnd() * 0.12),
        w: 0.16 + rnd() * 0.08,
        h: 0.11 + rnd() * 0.06,
        d: 0.14 + rnd() * 0.08,
        rotY: rnd() * Math.PI,
      });
    }

    // Antena/beacon pada ~42% bangunan (di pojok atap), tinggi ≤ 0.8 agar
    // tidak menabrak label Billboard (label utama di topY + ~0.05→ +1.0).
    const antennaRoll = rnd();
    const antenna =
      antennaRoll < 0.42
        ? {
            rx: (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.08),
            rz: (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.08),
            w: 1,
            h: 0.5 + rnd() * 0.3,
            d: 1,
            rotY: 0,
          }
        : null;

    // Water tower silinder pada sebagian bangunan tanpa antena.
    const tank =
      antenna === null && rnd() < 0.6
        ? {
            rx: (rnd() - 0.5) * 0.3,
            rz: (rnd() - 0.5) * 0.3,
            w: 0.13 + rnd() * 0.05,
            h: 0.22 + rnd() * 0.1,
            d: 0.13 + rnd() * 0.05,
            rotY: rnd() * Math.PI,
          }
        : null;

    return { txType, x, z, ac, antenna, tank };
  });
}

const DEFAULT_ROOFTOP_SPECS = generateRooftopSpecs();

/* --- Komponen global ------------------------------------------------------- */

const AC_CAPACITY = 36; // 12 bangunan × maks 3 unit AC
const MAST_CAPACITY = 12;
const TANK_CAPACITY = 12;
const sharedDummy = new THREE.Object3D(); // dipakai ulang — nol alokasi

/**
 * RooftopDetails — SATU komponen global untuk seluruh kota (dipakai oleh
 * World, bukan per bangunan): 3 InstancedMesh (AC, antena, water tower) =
 * 3 draw call total. Posisi instans di-update tiap frame dari registry
 * live-state sehingga detail rooftop MENEMPEL di atas tower yang di-lerp
 * (tidak floating), termasuk saat pulse/hover.
 *
 * Wiring (orchestrator): mount <RooftopDetails /> sekali di World.tsx
 * (sejajar <Vegetation />). Tanpa mount, bangunan tetap berfungsi normal —
 * hanya detail rooftop yang belum muncul.
 */
export function RooftopDetails({ specs = DEFAULT_ROOFTOP_SPECS }: { specs?: RooftopDetailSpec[] }) {
  const acRef = useRef<THREE.InstancedMesh>(null);
  const mastRef = useRef<THREE.InstancedMesh>(null);
  const tankRef = useRef<THREE.InstancedMesh>(null);

  // instanceMatrix di-update tiap frame → DynamicDrawUsage (hemat bandwidth).
  useLayoutEffect(() => {
    const meshes = [acRef.current, mastRef.current, tankRef.current];
    for (const m of meshes) m?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, []);

  useFrame(() => {
    const ac = acRef.current;
    const mast = mastRef.current;
    const tank = tankRef.current;
    let acN = 0;
    let mastN = 0;
    let tankN = 0;

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const live = rooftopLiveStates.get(spec.txType);
      if (!live || live.halfTopWidth <= 0) continue;
      const hw = live.halfTopWidth;

      for (let j = 0; j < spec.ac.length && ac; j++) {
        if (acN >= AC_CAPACITY) break;
        const a = spec.ac[j];
        sharedDummy.position.set(spec.x + a.rx * hw, live.topY + a.h / 2, spec.z + a.rz * hw);
        sharedDummy.rotation.set(0, a.rotY, 0);
        sharedDummy.scale.set(a.w, a.h, a.d);
        sharedDummy.updateMatrix();
        ac.setMatrixAt(acN++, sharedDummy.matrix);
      }

      const m = spec.antenna;
      if (m && mast && mastN < MAST_CAPACITY) {
        sharedDummy.position.set(spec.x + m.rx * hw, live.topY + m.h / 2, spec.z + m.rz * hw);
        sharedDummy.rotation.set(0, m.rotY, 0);
        sharedDummy.scale.set(1, m.h, 1);
        sharedDummy.updateMatrix();
        mast.setMatrixAt(mastN++, sharedDummy.matrix);
      }

      const t = spec.tank;
      if (t && tank && tankN < TANK_CAPACITY) {
        sharedDummy.position.set(spec.x + t.rx * hw, live.topY + t.h / 2, spec.z + t.rz * hw);
        sharedDummy.rotation.set(0, t.rotY, 0);
        sharedDummy.scale.set(t.w, t.h, t.d);
        sharedDummy.updateMatrix();
        tank.setMatrixAt(tankN++, sharedDummy.matrix);
      }
    }

    if (ac) {
      ac.count = acN;
      ac.instanceMatrix.needsUpdate = true;
    }
    if (mast) {
      mast.count = mastN;
      mast.instanceMatrix.needsUpdate = true;
    }
    if (tank) {
      tank.count = tankN;
      tank.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Unit AC kotak — galvanis. */}
      <instancedMesh ref={acRef} args={[undefined, undefined, AC_CAPACITY]} frustumCulled={false} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#a7adb5" roughness={0.45} metalness={0.55} />
      </instancedMesh>

      {/* Antena/menara tipis + beacon merah redam (emissive statis). */}
      <instancedMesh ref={mastRef} args={[undefined, undefined, MAST_CAPACITY]} frustumCulled={false}>
        <cylinderGeometry args={[0.016, 0.03, 1, 6]} />
        <meshStandardMaterial
          color="#c2c7cd"
          roughness={0.35}
          metalness={0.85}
          emissive="#ff4444"
          emissiveIntensity={0.35}
        />
      </instancedMesh>

      {/* Water tower silinder menyempit ke atas (tapered). */}
      <instancedMesh ref={tankRef} args={[undefined, undefined, TANK_CAPACITY]} frustumCulled={false} castShadow>
        <cylinderGeometry args={[0.8, 1, 1, 10]} />
        <meshStandardMaterial color="#6f5c4b" roughness={0.85} metalness={0.1} />
      </instancedMesh>
    </group>
  );
}
