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
  bridgeHeightAt,
  HIGHWAY_H,
  HIGHWAY_PERIMETER,
  HIGHWAY_LANE_OFFSET,
  ROAD_B_Z,
  ROAD_C_Z,
  ROAD_END_X,
  TOLL_X,
  TOLL_DECK_Y,
  TOLL_HALF_LEN,
  TOLL_LANE_OFFSET,
} from "./RoadNetwork";

/* ---------------------------------------------------------------------------
 * Traffic — lalu-lalang mobil di: ring avenue, 3 jalan lurus biasa
 * (ROAD_Z, ROAD_B_Z, ROAD_C_Z), ring highway luar (jalan tol keliling) &
 * viaduct tol (x=TOLL_X). Semua mengikuti skala kota dari RoadNetwork.
 *
 * KONSEP KEPADATAN (baru):
 * - Jumlah mobil AKTIF per jalur mengikuti `networkStats.trafficDensity`
 *   (0-100, dari Blockscout /stats network_utilization_percentage, poll 1×/60s
 *   oleh gas-collector). Makin ramai jaringan blockchain → makin ramai mobil.
 * - Kecepatan mobil TIDAK berubah (BASE_SPEED tetap; faktor TPS dihapus —
 *   kepadatan kini murni via jumlah mobil).
 * - Transisi halus: intensitas di-lerp 0.03/frame (tanpa pop saat Blockscout
 *   update), jumlah aktif per jalur di-round dari intensitas.
 * - Mobil non-aktif tetap dalam InstancedMesh (skala 0, y=-100) — tanpa
 *   remount, tanpa alokasi per frame.
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

/** ID jalur — urutan sama dengan konfigurasi PATHS di bawah. */
const PATH = {
  RING: 0,
  ROAD_Z: 1,
  ROAD_B: 2,
  ROAD_C: 3,
  HIGHWAY: 4,
  TOLL: 5,
} as const;

type PathKey = (typeof PATH)[keyof typeof PATH];

/** Konfigurasi jalur: total instance, rentang mobil aktif (min..max). */
const PATHS: Record<PathKey, { count: number; min: number; max: number }> = {
  [PATH.RING]: { count: 40, min: 16, max: 40 },
  [PATH.ROAD_Z]: { count: 8, min: 2, max: 8 },
  [PATH.ROAD_B]: { count: 8, min: 2, max: 8 },
  [PATH.ROAD_C]: { count: 8, min: 2, max: 8 },
  [PATH.HIGHWAY]: { count: 24, min: 6, max: 24 },
  [PATH.TOLL]: { count: 16, min: 4, max: 16 },
};

const PATH_KEYS = Object.values(PATH) as PathKey[];
const TOTAL_CARS = PATH_KEYS.reduce<number>((sum, k) => sum + PATHS[k].count, 0); // 104

const BASE_SPEED = 2.2; // unit/s — TETAP (≈36 km/jam riil); kepadatan via jumlah
const ROAD_SURFACE_Y = 0.02;
const MAX_DELTA = 0.1; // guard lompatan saat tab di-background
/** Kepadatan minimum yang berarti — di bawah ini semua jalur pakai `min`. */
const DENSITY_FLOOR = 0.05;

/** Palet sipil 7 warna + taksi kuning (~15% mobil). */
const CIVILIAN_COLORS = ["#b8434a", "#4a6fb8", "#d8d8d8", "#3c414c", "#4f7a58", "#c67b3b", "#8a8f99"].map(
  (c) => new THREE.Color(c),
);
const TAXI_COLOR = new THREE.Color("#e3c23c");

interface CarSpec {
  path: PathKey;
  dir: 1 | -1;
  s0: number; // offset awal sepanjang path
  scale: number; // variasi ukuran 0.9–1.1
  color: THREE.Color;
}

interface Pose {
  x: number;
  y: number; // permukaan jalan (ground 0.02, dek tol TOLL_DECK_Y+0.02)
  z: number;
  angle: number;
}

/** Pose parametrik ring (avenue / highway luar) — keliling persegi, kanan. */
function ringPose(sRaw: number, dir: 1 | -1, halfH: number, laneOffset: number, perimeter: number, y: number, out: Pose): void {
  let s = sRaw % perimeter;
  if (s < 0) s += perimeter;
  const t = dir === 1 ? s : perimeter - s;
  const segLen = 2 * halfH;
  const seg = Math.min(3, Math.floor(t / segLen));
  const u = t - seg * segLen;
  let x = 0;
  let z = 0;
  let hx = 0;
  let hz = 0;
  if (seg === 0) {
    x = halfH;
    z = -halfH + u;
    hz = 1;
  } else if (seg === 1) {
    x = halfH - u;
    z = halfH;
    hx = -1;
  } else if (seg === 2) {
    x = -halfH;
    z = halfH - u;
    hz = -1;
  } else {
    x = -halfH + u;
    z = -halfH;
    hx = 1;
  }
  if (dir === -1) {
    hx = -hx;
    hz = -hz;
  }
  // Right vector heading (hx,hz) pada bidang XZ = (hz, -hx) → lajur kanan.
  out.x = x + hz * laneOffset;
  out.z = z + -hx * laneOffset;
  // Lift jembatan hanya di sisi vertikal (melintang sungai RIVER_Z).
  out.y = y + (seg === 0 || seg === 2 ? bridgeHeightAt(out.z) : 0);
  out.angle = Math.atan2(hx, hz);
}

/** Pose jalan lurus sejajar X (ROAD_Z / ROAD_B_Z / ROAD_C_Z) — wrap di ujung. */
function straightXPose(sRaw: number, dir: 1 | -1, zCorridor: number, halfLen: number, out: Pose): void {
  const pathLen = 2 * halfLen;
  let s = sRaw % pathLen;
  if (s < 0) s += pathLen;
  const t = dir === 1 ? s : pathLen - s;
  const lane = dir === 1 ? -LANE_OFFSET : LANE_OFFSET;
  out.x = -halfLen + t;
  out.y = ROAD_SURFACE_Y;
  out.z = zCorridor + lane;
  out.angle = Math.atan2(dir, 0);
}

/** Pose viaduct tol — sejajar Z di x=TOLL_X, ketinggian dek (konstan). */
function tollPose(sRaw: number, dir: 1 | -1, out: Pose): void {
  const pathLen = 2 * TOLL_HALF_LEN;
  let s = sRaw % pathLen;
  if (s < 0) s += pathLen;
  const t = dir === 1 ? s : pathLen - s;
  out.x = TOLL_X + (dir === 1 ? -TOLL_LANE_OFFSET : TOLL_LANE_OFFSET);
  out.y = TOLL_DECK_Y + ROAD_SURFACE_Y;
  out.z = -TOLL_HALF_LEN + t;
  out.angle = dir === 1 ? 0 : Math.PI;
}

/** Panjang domain parametrik per jalur (untuk sebar awal mobil). */
function pathLength(key: PathKey): number {
  if (key === PATH.RING) return RING_PERIMETER;
  if (key === PATH.HIGHWAY) return HIGHWAY_PERIMETER;
  if (key === PATH.TOLL) return TOLL_HALF_LEN * 2;
  if (key === PATH.ROAD_Z) return ROAD_HALF_LEN * 2;
  return ROAD_END_X * 2; // ROAD_B & ROAD_C
}

/** Spesifikasi semua mobil — deterministik (seed tetap), merata per jalur. */
function generateCars(): CarSpec[] {
  const rnd = mulberry32(20260903);
  const cars: CarSpec[] = [];
  const gapJitter = (max: number) => (rnd() - 0.5) * 2 * max;

  for (const key of PATH_KEYS) {
    const cfg = PATHS[key];
    const perDir = cfg.count / 2;
    const spread = pathLength(key);
    for (let i = 0; i < cfg.count; i++) {
      const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const laneIdx = Math.floor(i / 2);
      cars.push({
        path: key,
        dir,
        s0: (laneIdx + 0.5) * (spread / perDir) + gapJitter(0.9),
        scale: 0.9 + rnd() * 0.2,
        color: rnd() < 0.15 ? TAXI_COLOR : CIVILIAN_COLORS[Math.floor(rnd() * CIVILIAN_COLORS.length)],
      });
    }
  }
  return cars;
}

export function Traffic() {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const cabinRef = useRef<THREE.InstancedMesh>(null);

  // Kepadatan target (0-100) — dari Blockscout utilization (poll 60s).
  const density = useGasStore((s) => s.networkStats.trafficDensity);

  // Intensitas halus (lerp per frame) — hindari pop saat Blockscout update.
  const intensityRef = useRef(0.5);

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
  const pose = useMemo<Pose>(() => ({ x: 0, y: 0, z: 0, angle: 0 }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    const cabin = cabinRef.current;
    if (!body || !cabin) return;

    // Lerp halus intensitas (0.03/frame) menuju target kepadatan store.
    const target = Math.min(Math.max(density / 100, DENSITY_FLOOR), 1);
    intensityRef.current += (target - intensityRef.current) * 0.03;
    const intensity = intensityRef.current;

    const d = delta > MAX_DELTA ? MAX_DELTA : delta;

    let i = 0;
    for (const key of PATH_KEYS) {
      const cfg = PATHS[key];
      const activeNow = Math.round(cfg.min + (cfg.max - cfg.min) * intensity);

      for (let j = 0; j < cfg.count; j++, i++) {
        const c = cars[i];
        c.s0 += BASE_SPEED * d; // kecepatan TETAP — kepadatan via jumlah mobil

        if (j >= activeNow) {
          // Non-aktif: sembunyikan (skala 0) — tanpa remount, tanpa alokasi.
          dummy.position.set(0, -100, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(0);
          dummy.updateMatrix();
          body.setMatrixAt(i, dummy.matrix);
          cabin.setMatrixAt(i, dummy.matrix);
          continue;
        }

        if (key === PATH.RING) {
          ringPose(c.s0, c.dir, RING_H, LANE_OFFSET, RING_PERIMETER, ROAD_SURFACE_Y, pose);
        } else if (key === PATH.HIGHWAY) {
          ringPose(c.s0, c.dir, HIGHWAY_H, HIGHWAY_LANE_OFFSET, HIGHWAY_PERIMETER, ROAD_SURFACE_Y, pose);
        } else if (key === PATH.TOLL) {
          tollPose(c.s0, c.dir, pose);
        } else if (key === PATH.ROAD_Z) {
          straightXPose(c.s0, c.dir, ROAD_Z, ROAD_HALF_LEN, pose);
        } else if (key === PATH.ROAD_B) {
          straightXPose(c.s0, c.dir, ROAD_B_Z, ROAD_END_X, pose);
        } else {
          straightXPose(c.s0, c.dir, ROAD_C_Z, ROAD_END_X, pose);
        }

        dummy.position.set(pose.x, pose.y, pose.z);
        dummy.rotation.set(0, pose.angle, 0);
        dummy.scale.set(c.scale, c.scale, c.scale);
        dummy.updateMatrix();
        body.setMatrixAt(i, dummy.matrix);
        cabin.setMatrixAt(i, dummy.matrix);
      }
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
