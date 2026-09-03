import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGasStore } from "@/store/gas-store";
import {
  RING_H,
  RING_PERIMETER,
  LANE_OFFSET,
  ROAD_Z,
  ROAD_HALF_LEN,
  ROAD_PATH_LEN,
  bridgeHeightAt,
} from "./RoadNetwork";

/* ---------------------------------------------------------------------------
 * Traffic — lalu-lalang mobil di ring avenue + jalan lurus ROAD_Z
 * (-SPACING/2, mirror koridor sungai).
 *
 * Konsep: kota hidup mengikuti aktivitas jaringan — kecepatan mobil = BASE
 * dikali faktor TPS dari useGasStore (selector granular s.networkStats.tps),
 * konsisten dengan DataRiver (speed-nya TPS). Clamp [0.5x, 3x].
 *
 * Kinerja (kontrak WAJIB):
 * - 48 mobil = 2 draw call (bodi + kabin, keduanya InstancedMesh).
 * - SATU useFrame untuk SEMUA mobil; 0 alokasi per frame (dummy Object3D +
 *   objek pose di-reuse, setMatrixAt in-place).
 * - Posisi parametrik: keliling persegi ring (linear per segmen) + jalan
 *   lurus ROAD_Z; wrap-around muncul di persimpangan (terbaca sebagai belok).
 * - Roda & lampu mobil di-skip (skala terlalu kecil / langit dinamis).
 * ------------------------------------------------------------------------- */

/** PRNG deterministik mulberry32 — identik dengan implementasi Vegetation. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RING_CARS_PER_DIR = 20; // ×2 arah = 40 mobil ring
const ROAD_CARS_PER_DIR = 4; // ×2 arah = 8 mobil jalan lurus ROAD_Z
const TOTAL_CARS = RING_CARS_PER_DIR * 2 + ROAD_CARS_PER_DIR * 2; // 48

const BASE_SPEED = 2.2; // unit/s pada faktor 1.0x — TETAP (≈36 km/jam riil,
// realistis terhadap mobil); keliling ring baru (×CITY_SCALE) ±531 dtk
const ROAD_SURFACE_Y = 0.02;
const MAX_DELTA = 0.1; // guard lompatan saat tab di-background

/** Palet sipil 7 warna + taksi kuning (~15% mobil). */
const CIVILIAN_COLORS = ["#b8434a", "#4a6fb8", "#d8d8d8", "#3c414c", "#4f7a58", "#c67b3b", "#8a8f99"].map(
  (c) => new THREE.Color(c),
);
const TAXI_COLOR = new THREE.Color("#e3c23c");

interface CarSpec {
  path: 0 | 1; // 0 = ring avenue, 1 = jalan lurus ROAD_Z
  dir: 1 | -1; // arah keliling / lintasan
  s0: number; // offset awal sepanjang path
  scale: number; // variasi ukuran 0.9–1.1
  color: THREE.Color;
}

interface Pose {
  x: number;
  z: number;
  angle: number;
  lift: number;
}

/** Pose parametrik ring (keliling persegi, linear per segmen, kanan sesuai arah).
 * dir=+1: sisi timur utara → utara barat → selatan barat → timur selatan (CCW).
 * dir=-1: traversal terbalik. Lajur: offset "keep right" → 2 lajur berlawanan. */
function ringPose(sRaw: number, dir: 1 | -1, out: Pose): void {
  let s = sRaw % RING_PERIMETER;
  if (s < 0) s += RING_PERIMETER;
  const t = dir === 1 ? s : RING_PERIMETER - s;
  const segLen = 2 * RING_H;
  const seg = Math.min(3, Math.floor(t / segLen));
  const u = t - seg * segLen;
  let x = 0;
  let z = 0;
  let hx = 0;
  let hz = 0;
  if (seg === 0) {
    x = RING_H;
    z = -RING_H + u;
    hz = 1;
  } else if (seg === 1) {
    x = RING_H - u;
    z = RING_H;
    hx = -1;
  } else if (seg === 2) {
    x = -RING_H;
    z = RING_H - u;
    hz = -1;
  } else {
    x = -RING_H + u;
    z = -RING_H;
    hx = 1;
  }
  if (dir === -1) {
    hx = -hx;
    hz = -hz;
  }
  // Right vector heading (hx,hz) pada bidang XZ = (hz, -hx) → lajur kanan.
  x += hz * LANE_OFFSET;
  z += -hx * LANE_OFFSET;
  out.x = x;
  out.z = z;
  out.angle = Math.atan2(hx, hz);
  // Lift jembatan hanya di sisi vertikal (melintang sungai RIVER_Z).
  out.lift = seg === 0 || seg === 2 ? bridgeHeightAt(z) : 0;
}

/** Pose jalan lurus ROAD_Z (x ∈ [-ROAD_HALF_LEN, ROAD_HALF_LEN]) — ujung
 * path tepat di persimpangan ring, sehingga wrap-around terbaca sebagai
 * mobil berbelok, bukan pop. */
function roadPose(sRaw: number, dir: 1 | -1, out: Pose): void {
  let s = sRaw % ROAD_PATH_LEN;
  if (s < 0) s += ROAD_PATH_LEN;
  const t = dir === 1 ? s : ROAD_PATH_LEN - s;
  out.x = -ROAD_HALF_LEN + t;
  out.z = ROAD_Z + (dir === 1 ? -LANE_OFFSET : LANE_OFFSET);
  out.angle = Math.atan2(dir, 0);
  out.lift = 0;
}

/** Spesifikasi 48 mobil — deterministik (seed tetap), sebaran merata per lajur. */
function generateCars(): CarSpec[] {
  const rnd = mulberry32(20260903);
  const cars: CarSpec[] = [];
  const gapJitter = (max: number) => (rnd() - 0.5) * 2 * max;

  for (let i = 0; i < RING_CARS_PER_DIR * 2; i++) {
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const laneIdx = Math.floor(i / 2);
    cars.push({
      path: 0,
      dir,
      s0: (laneIdx + 0.5) * (RING_PERIMETER / RING_CARS_PER_DIR) + gapJitter(0.9),
      scale: 0.9 + rnd() * 0.2,
      color: rnd() < 0.15 ? TAXI_COLOR : CIVILIAN_COLORS[Math.floor(rnd() * CIVILIAN_COLORS.length)],
    });
  }
  for (let i = 0; i < ROAD_CARS_PER_DIR * 2; i++) {
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const laneIdx = Math.floor(i / 2);
    cars.push({
      path: 1,
      dir,
      s0: (laneIdx + 0.5) * (ROAD_PATH_LEN / ROAD_CARS_PER_DIR) + gapJitter(1.0),
      scale: 0.9 + rnd() * 0.2,
      color: rnd() < 0.15 ? TAXI_COLOR : CIVILIAN_COLORS[Math.floor(rnd() * CIVILIAN_COLORS.length)],
    });
  }
  return cars;
}

export function Traffic() {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const cabinRef = useRef<THREE.InstancedMesh>(null);

  // TPS dibaca granular (primitive) — re-render hanya saat nilainya berubah,
  // useFrame membaca lewat closure (pola sama dengan DataRiver).
  const tps = useGasStore((s) => s.networkStats.tps);

  const cars = useMemo(generateCars, []);

  // Geometri + material sekali per mount. Offset lokal (tinggi/kabin) di-bake
  // ke geometri → bodi & kabin berbagi matrix instance yang sama per mobil.
  const assets = useMemo(() => {
    const bodyGeo = new THREE.BoxGeometry(0.55, 0.22, 1.0);
    bodyGeo.translate(0, 0.16, 0); // bodi span y 0.05–0.27
    const cabinGeo = new THREE.BoxGeometry(0.5, 0.17, 0.55);
    cabinGeo.translate(0, 0.355, -0.08); // kabin agak ke belakang (depan = +z)

    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.35 });
    const cabinMat = new THREE.MeshStandardMaterial({
      color: "#1c222b",
      roughness: 0.3,
      metalness: 0.4,
    });
    return { bodyGeo, cabinGeo, bodyMat, cabinMat };
  }, []);

  // Warna per instance (palet sipil + taksi) — SEKALI saat mount.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    for (let i = 0; i < cars.length; i++) body.setColorAt(i, cars[i].color);
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    cabinRef.current?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }, [cars]);

  // SATU useFrame untuk semua mobil — 0 alokasi (pose & dummy di-reuse).
  const pose = useMemo<Pose>(() => ({ x: 0, z: 0, angle: 0, lift: 0 }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const cabin = cabinRef.current;
    if (!body || !cabin) return;

    const safeTps = Number.isFinite(tps) ? tps : 0;
    const factor = Math.min(Math.max(0.5 + safeTps / 10, 0.5), 3); // clamp 0.5x–3x
    const d = delta > MAX_DELTA ? MAX_DELTA : delta;

    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.s0 += BASE_SPEED * factor * d;
      if (c.path === 0) ringPose(c.s0, c.dir, pose);
      else roadPose(c.s0, c.dir, pose);

      dummy.position.set(pose.x, ROAD_SURFACE_Y + pose.lift, pose.z);
      dummy.rotation.set(0, pose.angle, 0);
      dummy.scale.set(c.scale, c.scale, c.scale);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);
      cabin.setMatrixAt(i, dummy.matrix);
    }
    body.instanceMatrix.needsUpdate = true;
    cabin.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* Bodi mobil — warna variatif via setColorAt; castShadow hanya bodi */}
      <instancedMesh
        ref={bodyRef}
        args={[assets.bodyGeo, assets.bodyMat, TOTAL_CARS]}
        frustumCulled={false}
        castShadow
      />
      {/* Kabin/glass — gelap seragam, matrix sama dengan bodi */}
      <instancedMesh
        ref={cabinRef}
        args={[assets.cabinGeo, assets.cabinMat, TOTAL_CARS]}
        frustumCulled={false}
      />
    </group>
  );
}

export default Traffic;
