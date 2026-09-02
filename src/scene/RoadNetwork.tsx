import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* ---------------------------------------------------------------------------
 * RoadNetwork — jaringan jalan raya kota GasHood.
 *
 * Struktur (semua statis, dihitung SEKALI di useMemo — tanpa per-frame work):
 * 1. Ring avenue: persegi keliling di x,z = ±RING_H (lebar 1.6, 2 lajur),
 *    mengelilingi cluster bangunan (tepi bangunan ~7.4) di dalam sidewalk
 *    ring (13.0). 4 strip digabung (mergeGeometries) → 1 draw call, tekstur
 *    aspal noise dari canvas.
 * 2. Marka jalan: garis tepi solid + garis tengah putus-putus via canvas
 *    texture transparan (repeat sepanjang jalan, UV di-scale per strip).
 *    Semua marka digabung → 1 draw call.
 * 3. Zebra cross: 4 buah (1 per sisi ring), digabung → 1 draw call.
 * 4. Jembatan: ring melintasi sungai DataRiver (air z ∈ [1.31, 2.69], bank
 *    [1.09, 2.91]) di x = ±RING_H → 2 dek beton + pagar, digabung → 1 dc.
 * 5. Lampu jalan: 12 tiang + kepala (vertex color, 1 material) dalam SATU
 *    InstancedMesh → 1 draw call. Matriks di-set sekali saat mount.
 *
 * Total: 5 draw calls. Konstanta path diekspor & dipakai Traffic.tsx agar
 * tidak ada drift antara geometri jalan dan posisi mobil.
 * ------------------------------------------------------------------------- */

/** Half-size ring avenue (centerline) — antara tepi bangunan (~7.4) & sidewalk (13.0). */
export const RING_H = 9.75;
/** Keliling path ring (4 sisi × 2×RING_H) — domain parametrik mobil. */
export const RING_PERIMETER = 8 * RING_H;
/** Offset lajur dari centerline (lebar jalan 1.6 → 2 lajur @ ±0.4). */
export const LANE_OFFSET = 0.4;
/** Koridor jalan z=-2 milik World (strip 26×1.6) — domain mobil lurus. */
export const ROAD_Z = -2;
export const ROAD_HALF_LEN = RING_H; // x ∈ [-9.75, 9.75], ujung = persimpangan ring
export const ROAD_PATH_LEN = 2 * ROAD_HALF_LEN;
/** Tinggi dek jembatan (di atas bank 0.15 + toleransi roda-bayangan). */
export const BRIDGE_HEIGHT = 0.17;

/** Zona jembatan: z ∈ [0.5, 3.5], penuh di [1.5, 2.5], smoothstep ramp 1.0. */
export function bridgeHeightAt(z: number): number {
  if (z < 0.5 || z > 3.5) return 0;
  const smooth = (u: number) => u * u * (3 - 2 * u);
  if (z < 1.5) return BRIDGE_HEIGHT * smooth(z - 0.5);
  if (z <= 2.5) return BRIDGE_HEIGHT;
  return BRIDGE_HEIGHT * smooth(3.5 - z);
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

/** Box + translate — util untuk jembatan. */
function boxAt(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
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

const ROAD_WIDTH = 1.6;
const RING_STRIP_LEN = 2 * RING_H + ROAD_WIDTH; // 21.1 — stripan menutup sudut
const MARKING_Y = 0.011;
const CROSSWALK_Y = 0.0125;
const DASH_CYCLE = 4; // 1 tile marka = 4 unit jalan

// Vertikal side skip persimpangan z=-2 (jalan World, z ∈ [-2.9, -1.1]):
// marka terputus di persimpangan — realistik, tetap 1 draw call (merged).
const MARKING_SEGMENTS: {
  x: number;
  z: number;
  len: number;
  horizontal: boolean;
}[] = [];
for (const sx of [-1, 1]) {
  MARKING_SEGMENTS.push({ x: sx * RING_H, z: -6.725, len: 7.65, horizontal: false });
  MARKING_SEGMENTS.push({ x: sx * RING_H, z: 4.725, len: 11.65, horizontal: false });
}
for (const sz of [-1, 1]) {
  MARKING_SEGMENTS.push({ x: 0, z: sz * RING_H, len: RING_STRIP_LEN, horizontal: true });
}

// Zebra cross: 1 per sisi ring (titik tengah sisi, menghindari persimpangan z=-2).
const CROSSWALKS: { x: number; z: number; horizontal: boolean }[] = [
  { x: RING_H, z: 0, horizontal: false },
  { x: -RING_H, z: 0, horizontal: false },
  { x: 0, z: RING_H, horizontal: true },
  { x: 0, z: -RING_H, horizontal: true },
];

// Lampu jalan: 3 per sisi ring, di tepi luar (offset 1.2 dari centerline).
const LAMP_POSITIONS: [number, number][] = [];
for (const sx of [-1, 1])
  for (const t of [-4.875, 0, 4.875]) LAMP_POSITIONS.push([sx * (RING_H + 1.2), t]);
for (const sz of [-1, 1])
  for (const t of [-4.875, 0, 4.875]) LAMP_POSITIONS.push([t, sz * (RING_H + 1.2)]);

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

  // Geometri merged — aspal ring (4 strip), marka (6 strip), zebra (4), jembatan (6 box).
  const geos = useMemo(() => {
    const vScale = RING_STRIP_LEN / DASH_CYCLE;

    const asphaltParts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1])
      asphaltParts.push(
        flatStrip(ROAD_WIDTH, RING_STRIP_LEN, sx * RING_H, 0, 0.006, false, vScale),
      );
    for (const sz of [-1, 1])
      asphaltParts.push(
        flatStrip(ROAD_WIDTH, RING_STRIP_LEN, 0, sz * RING_H, 0.0072, true, vScale),
      );
    const asphalt = mergeGeometries(asphaltParts, false)!;
    asphaltParts.forEach((g) => g.dispose());

    const markingParts = MARKING_SEGMENTS.map((s) =>
      flatStrip(ROAD_WIDTH, s.len, s.x, s.z, MARKING_Y, s.horizontal, s.len / DASH_CYCLE),
    );
    const marking = mergeGeometries(markingParts, false)!;
    markingParts.forEach((g) => g.dispose());

    const crossParts = CROSSWALKS.map((s) =>
      flatStrip(ROAD_WIDTH, 0.9, s.x, s.z, CROSSWALK_Y, s.horizontal, 1),
    );
    const crosswalk = mergeGeometries(crossParts, false)!;
    crossParts.forEach((g) => g.dispose());

    // Jembatan: dek + 2 pagar per sisi (x = ±RING_H, melintang sungai z=2).
    const bridgeParts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      bridgeParts.push(boxAt(2.2, 0.18, 3.2, sx * RING_H, 0.07, 2));
      bridgeParts.push(boxAt(0.06, 0.12, 3.2, sx * RING_H - 1.07, 0.22, 2));
      bridgeParts.push(boxAt(0.06, 0.12, 3.2, sx * RING_H + 1.07, 0.22, 2));
    }
    const bridge = mergeGeometries(bridgeParts, false)!;
    bridgeParts.forEach((g) => g.dispose());

    // Lampu: tiang (cylinder) + kepala (box), warna per-vertex, 1 InstancedMesh.
    const pole = withColor(
      new THREE.CylinderGeometry(0.035, 0.05, 1.7, 6).translate(0, 0.85, 0),
      "#2e3238",
    );
    const head = withColor(new THREE.BoxGeometry(0.2, 0.07, 0.2).translate(0, 1.735, 0), "#e8d8a0");
    const lamp = mergeGeometries([pole, head], false)!;
    pole.dispose();
    head.dispose();

    return { asphalt, marking, crosswalk, bridge, lamp };
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
