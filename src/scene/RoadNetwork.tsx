import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* ---------------------------------------------------------------------------
 * RoadNetwork — jaringan jalan raya kota GasHood.
 *
 * Struktur (semua statis, dihitung SEKALI di useMemo — tanpa per-frame work):
 * 1. Ring avenue: persegi keliling di x,z = ±RING_H (lebar 1.6, 2 lajur),
 *    mengelilingi cluster bangunan (tepi bangunan ±105) di dalam sidewalk
 *    ring (±195). Posisi ×CITY_SCALE; lebar jalan & lajur TETAP (skala
 *    mobil). 4 strip digabung (mergeGeometries) → 1 draw call, tekstur
 *    aspal noise dari canvas.
 * 2. Marka jalan: garis tepi solid + garis tengah putus-putus via canvas
 *    texture transparan (repeat sepanjang jalan, UV di-scale per strip).
 *    Semua marka digabung → 1 draw call.
 * 3. Zebra cross: 4 buah (1 per sisi ring), digabung → 1 draw call.
 * 4. Jembatan: ring melintasi sungai DataRiver di x = ±RING_H → dek SEGMEN
 *    (12 segmen/sisi mengikuti ramp bridgeHeightAt) + pagar, digabung → 1 dc.
 * 5. Lampu jalan: 12 tiang + kepala (vertex color, 1 material) dalam SATU
 *    InstancedMesh → 1 draw call. Matriks di-set sekali saat mount.
 *
 * Total: 5 draw calls. Konstanta path diekspor & dipakai Traffic.tsx agar
 * tidak ada drift antara geometri jalan dan posisi mobil.
 * ------------------------------------------------------------------------- */

import { SPACING, CITY_SCALE, RIVER_Z } from "./layout";

/** Half-size ring avenue (centerline) — antara tepi bangunan (±105) &
 * sidewalk (±195). POSISI ×CITY_SCALE; lebar jalan tetap skala mobil. */
export const RING_H = 9.75 * CITY_SCALE;

/* ---- Jalan Tol (Highway) --------------------------------------------------
 * Jalan tol lebih lebar (3 lajur) di luar ring avenue, mengelilingi kota.
 * Posisi: ±14 * CITY_SCALE (di luar ring ±9.75). Lebar 2.4 (3 lajur @ 0.8).
 * Terhubung ke ring via on/off ramp di 4 titik (persimpangan).
 * --------------------------------------------------------------------------- */
export const HIGHWAY_H = 14 * CITY_SCALE; // half-size jalan tol
export const HIGHWAY_WIDTH = 2.4; // 3 lajur (lebar skala mobil)
export const HIGHWAY_PERIMETER = 8 * HIGHWAY_H;
export const HIGHWAY_LANE_OFFSET = 0.8; // offset lajur dari centerline

// Jalan tol horizontal (sumbu X) di z = ±HIGHWAY_H
// Jalan tol vertikal (sumbu Z) di x = ±HIGHWAY_H
// Terhubung ke ring via ramp pendek di persimpangan
/** Keliling path ring (4 sisi × 2×RING_H) — domain parametrik mobil. */
export const RING_PERIMETER = 8 * RING_H;
/** Offset lajur dari centerline (lebar jalan 1.6 → 2 lajur @ ±0.4) — TETAP. */
export const LANE_OFFSET = 0.4;
/** Koridor jalan z=-SPACING/2 milik World (mirror koridor sungai) — domain
 * mobil lurus. */
export const ROAD_Z = -SPACING / 2;
export const ROAD_HALF_LEN = RING_H; // x ∈ [-RING_H, RING_H], ujung = persimpangan ring
export const ROAD_PATH_LEN = 2 * ROAD_HALF_LEN;
/** Lift puncak jembatan ×CITY_SCALE — menaiki bank sungai yang kini 2.25
 * (0.15×CITY_SCALE). Konsumen (Traffic) menaikkan mobil sebesar
 * bridgeHeightAt(z); top dek segmen = lift(z) + 0.07 sehingga bawah bodi
 * mobil (lift + 0.07) menumpang persis di permukaan dek — termasuk di
 * puncak (top dek = BRIDGE_HEIGHT + 0.07). */
export const BRIDGE_HEIGHT = 0.17 * CITY_SCALE;

/** Zona jembatan ×CITY_SCALE (profesi lama digandakan): ramp z ∈
 * [RIVER_Z−22.5, RIVER_Z+22.5], penuh di [RIVER_Z−7.5, RIVER_Z+7.5],
 * smoothstep ramp selebar 15. */
const BRIDGE_ZONE_HALF = 1.5 * CITY_SCALE;
const BRIDGE_FULL_HALF = 0.5 * CITY_SCALE;
const BRIDGE_RAMP = 1.0 * CITY_SCALE;
export function bridgeHeightAt(z: number): number {
  if (z < RIVER_Z - BRIDGE_ZONE_HALF || z > RIVER_Z + BRIDGE_ZONE_HALF) return 0;
  const smooth = (u: number) => u * u * (3 - 2 * u);
  if (z < RIVER_Z - BRIDGE_FULL_HALF)
    return BRIDGE_HEIGHT * smooth((z - (RIVER_Z - BRIDGE_ZONE_HALF)) / BRIDGE_RAMP);
  if (z <= RIVER_Z + BRIDGE_FULL_HALF) return BRIDGE_HEIGHT;
  return BRIDGE_HEIGHT * smooth((RIVER_Z + BRIDGE_ZONE_HALF - z) / BRIDGE_RAMP);
}

/* ---- Tekstur canvas (dibuat sekali per mount, di-cache useMemo) ---------- */

/** Aspal: base gelap + spekel noise + beberapa patch pudar (variasi permukaan). */
function makeAsphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#262a31";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = Math.random();
    ctx.fillStyle =
      v > 0.5 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.07)";
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = "rgba(0,0,0,0.05)";
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * 128,
      Math.random() * 128,
      8 + Math.random() * 18,
      6 + Math.random() * 12,
      Math.random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping; // v di-scale per panjang strip (siklus 4 unit)
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Marka: garis tepi solid + garis tengah putus-putus (dash 60% siklus). */
function makeMarkingTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 256);
  ctx.fillStyle = "rgba(178,184,194,0.85)";
  // garis tepi solid kiri/kanan (u ≈ 0.05–0.11 dan 0.89–0.95)
  ctx.fillRect(3, 0, 4, 256);
  ctx.fillRect(57, 0, 4, 256);
  // garis tengah putus-putus (dash 60% tinggi tile)
  ctx.fillRect(29, 0, 5, 154);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Zebra cross: 5 bar putih memanjang melintang jalan. */
function makeCrosswalkTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = "rgba(205,210,218,0.9)";
  for (let i = 0; i < 5; i++) ctx.fillRect(0, 6 + i * 26, 128, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---- Helper geometri ------------------------------------------------------ */

/** Plane flat (rot X -90°, opsional rot Y 90° utk jalan sejajar x) + UV-v
 * di-scale (repeat sepanjang jalan) + translate ke posisi dunia. */
function flatStrip(
  width: number,
  len: number,
  x: number,
  z: number,
  y: number,
  horizontal: boolean,
  vScale: number,
): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(width, len);
  g.rotateX(-Math.PI / 2);
  if (horizontal) g.rotateY(Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * vScale);
  g.translate(x, y, z);
  return g;
}

/** Isi attribute `color` per-vertex (untuk lampu: tiang vs kepala beda warna
 * dalam SATU material vertexColors). */
function withColor(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const col = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/* ---- Konstanta layout ----------------------------------------------------- */

const ROAD_WIDTH = 1.6; // TETAP — lebar jalan skala mobil (~5.5 m riil)
const RING_STRIP_LEN = 2 * RING_H + ROAD_WIDTH; // stripan menutup sudut
export const ROAD_B_Z = -90; // koridor jalan raya biasa B (sejajar X)
export const ROAD_C_Z = 90; // koridor jalan raya biasa C (sejajar X)
export const ROAD_END_X = 9.75 * CITY_SCALE; // ujung x jalan raya (= RING_H, menyambung ring)
export const TOLL_X = 60; // centerline tol (sejajar Z), koridor antara gedung x=30 & x=90
export const TOLL_DECK_Y = 6; // tinggi dek tol di atas tanah
export const TOLL_HALF_LEN = 180; // z ∈ [-180, +180]
export const TOLL_LANE_OFFSET = 0.8; // offset lajur tol dari centerline
const TOLL_GANTRY_Z = [-120, 120]; // z gerbang tol
// Zona z di mana PILAR tol TIDAK boleh berdiri: ring avenue (±RING_H),
// jalan raya biasa (±90), koridor jalan World (ROAD_Z) & sungai (RIVER_Z).
const TOLL_PILLAR_SKIP: [number, number][] = [
  [-90 - 5, -90 + 5],
  [90 - 5, 90 + 5],
  [RIVER_Z - 5, RIVER_Z + 5],
  [ROAD_Z - 5, ROAD_Z + 5],
  [-RING_H - 5, -RING_H + 5],
  [RING_H - 5, RING_H + 5],
];
/* Offset-y lapisan jalan ×CITY_SCALE — alasan sama dengan World.tsx
 * (offset mikrometer z-fight di depth 24-bit jarak kota). Urutan di atas
 * plaza World (0.075) & jalan World (0.12):
 *   aspal ring vertikal(0.09) < horizontal(0.108) < marka(0.165) < zebra(0.1875) */
const ASPHALT_Y_V = 0.006 * CITY_SCALE; // 0.09
const ASPHALT_Y_H = 0.0072 * CITY_SCALE; // 0.108
const MARKING_Y = 0.011 * CITY_SCALE; // 0.165
const CROSSWALK_Y = 0.0125 * CITY_SCALE; // 0.1875
const DASH_CYCLE = 4; // TETAP — 1 tile marka = 4 unit jalan (skala mobil)

// Vertikal side skip persimpangan ROAD_Z (jalan World selebar 1.6 + margin
// 0.1 — ukuran skala-jalan, TETAP): marka terputus di persimpangan —
// realistik, tetap 1 draw call (merged). Segmen diturunkan dari RING_H &
// ROAD_Z agar otomatis mengikuti CITY_SCALE.
const INTER_HALF = ROAD_WIDTH / 2 + 0.1;
const SIDE_END = RING_H + ROAD_WIDTH / 2; // ujung strip vertikal (menutup sudut)
const MARKING_SEGMENTS: {
  x: number;
  z: number;
  len: number;
  horizontal: boolean;
}[] = [];
for (const sx of [-1, 1]) {
  // Segmen sisi vertikal di bawah persimpangan (ujung ring → tepi koridor).
  MARKING_SEGMENTS.push({
    x: sx * RING_H,
    z: (ROAD_Z - INTER_HALF - SIDE_END) / 2,
    len: ROAD_Z - INTER_HALF + SIDE_END,
    horizontal: false,
  });
  // Segmen di atas persimpangan (tepi koridor lain → ujung ring).
  MARKING_SEGMENTS.push({
    x: sx * RING_H,
    z: (SIDE_END + ROAD_Z + INTER_HALF) / 2,
    len: SIDE_END - (ROAD_Z + INTER_HALF),
    horizontal: false,
  });
}
for (const sz of [-1, 1]) {
  MARKING_SEGMENTS.push({ x: 0, z: sz * RING_H, len: RING_STRIP_LEN, horizontal: true });
}

// Zebra cross: 1 per sisi ring (titik tengah sisi, menghindari persimpangan).
const CROSSWALKS: { x: number; z: number; horizontal: boolean }[] = [
  { x: RING_H, z: 0, horizontal: false },
  { x: -RING_H, z: 0, horizontal: false },
  { x: 0, z: RING_H, horizontal: true },
  { x: 0, z: -RING_H, horizontal: true },
];

// Lampu jalan: 3 per sisi ring, di tepi luar. Offset 1.2 dari centerline
// TETAP (skala pejalan kaki, ~4 m riil); titik t = ±RING_H/2 (kuartal sisi).
const LAMP_ROAD_OFFSET = 1.2;
const LAMP_POSITIONS: [number, number][] = [];
for (const sx of [-1, 1])
  for (const t of [-RING_H / 2, 0, RING_H / 2]) LAMP_POSITIONS.push([sx * (RING_H + LAMP_ROAD_OFFSET), t]);
for (const sz of [-1, 1])
  for (const t of [-RING_H / 2, 0, RING_H / 2]) LAMP_POSITIONS.push([t, sz * (RING_H + LAMP_ROAD_OFFSET)]);

export function RoadNetwork() {
  const lampRef = useRef<THREE.InstancedMesh>(null);

  // Material & tekstur — sekali per mount.
  const mats = useMemo(() => {
    const asphalt = new THREE.MeshStandardMaterial({
      map: makeAsphaltTexture(),
      roughness: 0.92,
      metalness: 0,
    });
    const concrete = new THREE.MeshStandardMaterial({
      color: "#3d4046",
      roughness: 1,
      metalness: 0,
    });
    const marking = new THREE.MeshBasicMaterial({
      map: makeMarkingTexture(),
      transparent: true,
      depthWrite: false,
    });
    const crosswalk = new THREE.MeshBasicMaterial({
      map: makeCrosswalkTexture(),
      transparent: true,
      depthWrite: false,
    });
    const lamp = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.1,
    });
    return { asphalt, concrete, marking, crosswalk, lamp };
  }, []);

  // Geometri merged — aspal ring (4 strip), jalan tol (4 strip), marka, zebra, jembatan.
  const geos = useMemo(() => {
    const vScale = RING_STRIP_LEN / DASH_CYCLE;

    const asphaltParts: THREE.BufferGeometry[] = [];
    // Ring avenue — 4 strip
    for (const sx of [-1, 1])
      asphaltParts.push(
        flatStrip(ROAD_WIDTH, RING_STRIP_LEN, sx * RING_H, 0, ASPHALT_Y_V, false, vScale),
      );
    for (const sz of [-1, 1])
      asphaltParts.push(
        flatStrip(ROAD_WIDTH, RING_STRIP_LEN, 0, sz * RING_H, ASPHALT_Y_H, true, vScale),
      );
    // Jalan tol (highway) — 4 strip lebih lebar di luar ring
    const HW_STRIP_LEN = 2 * HIGHWAY_H + HIGHWAY_WIDTH;
    const hwVScale = HW_STRIP_LEN / DASH_CYCLE;
    for (const sx of [-1, 1])
      asphaltParts.push(
        flatStrip(HIGHWAY_WIDTH, HW_STRIP_LEN, sx * HIGHWAY_H, 0, ASPHALT_Y_V + 0.002, false, hwVScale),
      );
    for (const sz of [-1, 1])
      asphaltParts.push(
        flatStrip(HIGHWAY_WIDTH, HW_STRIP_LEN, 0, sz * HIGHWAY_H, ASPHALT_Y_H + 0.002, true, hwVScale),
      );
    // Jalan raya biasa B & C — sejajar X, ujung x = ROAD_END_X (sambung ring).
    asphaltParts.push(flatStrip(ROAD_WIDTH, ROAD_END_X * 2, 0, ROAD_B_Z, ASPHALT_Y_H, true, vScale));
    asphaltParts.push(flatStrip(ROAD_WIDTH, ROAD_END_X * 2, 0, ROAD_C_Z, ASPHALT_Y_H, true, vScale));
    const asphalt = mergeGeometries(asphaltParts, false)!;
    asphaltParts.forEach((g) => g.dispose());

    const markingParts = MARKING_SEGMENTS.map((s) =>
      flatStrip(ROAD_WIDTH, s.len, s.x, s.z, MARKING_Y, s.horizontal, s.len / DASH_CYCLE),
    );
    // Marka jalan raya biasa B & C (garis tepi + tengah putus).
    markingParts.push(flatStrip(ROAD_WIDTH, ROAD_END_X * 2, 0, ROAD_B_Z, MARKING_Y, true, (ROAD_END_X * 2) / DASH_CYCLE));
    markingParts.push(flatStrip(ROAD_WIDTH, ROAD_END_X * 2, 0, ROAD_C_Z, MARKING_Y, true, (ROAD_END_X * 2) / DASH_CYCLE));
    // Marka dek tol (garis tepi + tengah) — memanjang sumbu Z di x=TOLL_X.
    markingParts.push(flatStrip(3.2, TOLL_HALF_LEN * 2, TOLL_X, 0, TOLL_DECK_Y + 0.015, false, (TOLL_HALF_LEN * 2) / DASH_CYCLE));
    const marking = mergeGeometries(markingParts, false)!;
    markingParts.forEach((g) => g.dispose());

    const crossParts = CROSSWALKS.map((s) =>
      flatStrip(ROAD_WIDTH, 0.9, s.x, s.z, CROSSWALK_Y, s.horizontal, 1),
    );
    const crosswalk = mergeGeometries(crossParts, false)!;
    crossParts.forEach((g) => g.dispose());

    // Jembatan: dek SEGMEN MIRING mengikuti bridgeHeightAt (bukan box flat) —
    // mobil (Traffic, lift = bridgeHeightAt) menumpang tepat di permukaan dek
    // di SELURUH ramp, dan slab tidak mengiris air/bank sungai. Bentang dek =
    // zona ramp PENUH (2×BRIDGE_ZONE_HALF = 45, z ∈ [RIVER_Z−22.5, RIVER_Z+
    // 22.5]) → 15 segmen × 3 unit; boundary segmen jatuh PERSIS di tepi ramp
    // (z=7.5/52.5, lift=0) → top dek di tepi = 0.07 = bawah bodi mobil darat.
    // Tiap segmen = box di-rotateX sehingga top-nya menghubungkan lift(z0)→
    // lift(z1) (chord) → permukaan piecewise-linear PERSIS kontinu di setiap
    // joint, digabung → 1 draw call. Lebar dek (2.2, mengikuti jalan 1.6) &
    // pagar (0.06×0.12) TETAP — skala mobil.
    //
    // Top segmen = lift(z) + DECK_CONTACT: DECK_CONTACT = ROAD_SURFACE_Y
    // (0.02, Traffic) + offset bawah-bodi mobil (0.05) → bawah bodi mobil
    // PERSIS menyentuh top dek di setiap z (di puncak → top dek =
    // BRIDGE_HEIGHT + 0.07). Pagar ikut mengikuti kemiringan segmen.
    const DECK_SEGMENTS = 15;
    const DECK_SPAN = 2 * BRIDGE_ZONE_HALF; // 45 — tepat zona ramp jembatan
    const DECK_SEG_LEN = DECK_SPAN / DECK_SEGMENTS; // 3
    const DECK_THICK = 0.3;
    const DECK_CONTACT = 0.07;
    const DECK_Z0 = RIVER_Z - BRIDGE_ZONE_HALF;
    const bridgeParts: THREE.BufferGeometry[] = [];
    // Jembatan dibangun di KEDUA ring (avenue & highway luar) — keduanya
    // melintasi sungai pada sisi vertikal (x = ±H, z ≈ RIVER_Z).
    for (const ringR of [RING_H, HIGHWAY_H]) {
      for (const sx of [-1, 1]) {
        for (let i = 0; i < DECK_SEGMENTS; i++) {
          const z0 = DECK_Z0 + i * DECK_SEG_LEN;
          const z1 = z0 + DECK_SEG_LEN;
          const zc = (z0 + z1) / 2;
          // Chord antara lift ujung-ujung → top dek kontinu antar segmen.
          const y0 = bridgeHeightAt(z0) + DECK_CONTACT;
          const y1 = bridgeHeightAt(z1) + DECK_CONTACT;
          const topMid = (y0 + y1) / 2;
          const angle = Math.atan((y1 - y0) / DECK_SEG_LEN);
          // Panjang box dikoreksi 1/cos agar proyeksi horizontal = DECK_SEG_LEN
          // (ujung segmen tepat bertemu di z0/z1 — tanpa celah).
          const segLen = DECK_SEG_LEN / Math.cos(angle);
          bridgeParts.push(
            new THREE.BoxGeometry(2.2, DECK_THICK, segLen)
              .rotateX(-angle)
              .translate(sx * ringR, topMid - DECK_THICK / 2, zc),
          );
          bridgeParts.push(
            new THREE.BoxGeometry(0.06, 0.12, segLen)
              .rotateX(-angle)
              .translate(sx * ringR - 1.07, topMid + 0.06, zc),
          );
          bridgeParts.push(
            new THREE.BoxGeometry(0.06, 0.12, segLen)
              .rotateX(-angle)
              .translate(sx * ringR + 1.07, topMid + 0.06, zc),
          );
        }
      }
    }
    const bridge = mergeGeometries(bridgeParts, false)!;
    bridgeParts.forEach((g) => g.dispose());

    // Jalan tol viaduct — sejajar sumbu Z di x=TOLL_X, dek di ketinggian
    // TOLL_DECK_Y (lebar 3.2 utk 2 lajur). Dek + pilar + gerbang tol digabung
    // → 1 draw call (material mats.concrete).
    const tollParts: THREE.BufferGeometry[] = [];
    // Dek — tengah box di y = TOLL_DECK_Y - 0.25 agar permukaan atas ≈ TOLL_DECK_Y.
    tollParts.push(
      new THREE.BoxGeometry(3.2, 0.5, TOLL_HALF_LEN * 2).translate(TOLL_X, TOLL_DECK_Y - 0.25, 0),
    );
    // Pilar — tiap 12 unit, di-skip di zona TOLL_PILLAR_SKIP.
    for (let z = -TOLL_HALF_LEN + 6; z < TOLL_HALF_LEN - 4; z += 12) {
      if (TOLL_PILLAR_SKIP.some(([a, b]) => z >= a && z <= b)) continue;
      tollParts.push(
        new THREE.BoxGeometry(0.8, TOLL_DECK_Y - 0.5, 0.8).translate(TOLL_X, (TOLL_DECK_Y - 0.5) / 2, z),
      );
    }
    // Gerbang tol di TOLL_GANTRY_Z — balok melintang di atas dek.
    for (const gz of TOLL_GANTRY_Z) {
      tollParts.push(
        new THREE.BoxGeometry(4.4, 0.4, 0.4).translate(TOLL_X, TOLL_DECK_Y + 1.4, gz),
      );
    }
    const toll = mergeGeometries(tollParts, false)!;
    tollParts.forEach((g) => g.dispose());

    // Lampu: tiang (cylinder) + kepala (box), warna per-vertex, 1 InstancedMesh.
    const pole = withColor(
      new THREE.CylinderGeometry(0.035, 0.05, 1.7, 6).translate(0, 0.85, 0),
      "#2e3238",
    );
    const head = withColor(new THREE.BoxGeometry(0.2, 0.07, 0.2).translate(0, 1.735, 0), "#e8d8a0");
    const lamp = mergeGeometries([pole, head], false)!;
    pole.dispose();
    head.dispose();

    return { asphalt, marking, crosswalk, bridge, toll, lamp };
  }, []);

  // Matriks lampu di-set SEKALI saat mount — statis, tanpa per-frame update.
  useLayoutEffect(() => {
    const mesh = lampRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < LAMP_POSITIONS.length; i++) {
      dummy.position.set(LAMP_POSITIONS[i][0], 0, LAMP_POSITIONS[i][1]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      {/* Aspal ring avenue — merged 4 strip, 1 draw call */}
      <mesh geometry={geos.asphalt} material={mats.asphalt} receiveShadow />
      {/* Marka (garis tepi + tengah putus) — merged, 1 draw call */}
      <mesh geometry={geos.marking} material={mats.marking} renderOrder={1} />
      {/* Zebra cross — merged 4 sisi, 1 draw call */}
      <mesh geometry={geos.crosswalk} material={mats.crosswalk} renderOrder={1} />
      {/* Jembatan melintang sungai — merged dek + pagar, 1 draw call */}
      <mesh geometry={geos.bridge} material={mats.concrete} castShadow receiveShadow />
      {/* Jalan tol viaduct — merged dek + pilar + gerbang, 1 draw call */}
      <mesh geometry={geos.toll} material={mats.concrete} castShadow receiveShadow />
      {/* Lampu jalan — 1 InstancedMesh (tiang + kepala, vertex color) */}
      <instancedMesh
        ref={lampRef}
        args={[geos.lamp, mats.lamp, LAMP_POSITIONS.length]}
        frustumCulled={false}
      />
    </group>
  );
}

export default RoadNetwork;
