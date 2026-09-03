import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CITY_SCALE, RIVER_Z } from "./layout";

/* ---------------------------------------------------------------------------
 * Vegetasi statis GasHood — hutan + rumput.
 * 1/3 area map dipenuhi pepohonan secara acak dan natural.
 * Tidak menimpa: bangunan (grid 4×3), sungai, plaza, sidewalk.
 * ------------------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TREE_COUNT = 220;
const GRASS_COUNT = 800;

// ── Zona terlarang (tidak boleh ada pohon) ──────────────────────────
// Grid bangunan 4×3, spacing = SPACING (4×CITY_SCALE).
// Setiap bangunan punya footprint ~2×2 (lebar max 2 × 1.05 hover × 1.05 scale).
const BUILDING_HALF_W = 1.5 * CITY_SCALE; // margin aman di sekitar bangunan
const RIVER_X_RANGE = 18 * CITY_SCALE; // sungai membentang x ±18
const PLAZA_HALF = 13 * CITY_SCALE; // plaza aspal
const SIDEWALK_RING = 13.5 * CITY_SCALE; // sidewalk ring

// Grid posisi bangunan (sama dengan layout.ts tapi untuk collision check)
const BUILDING_POSITIONS: [number, number][] = [
  [-6 * CITY_SCALE, -4 * CITY_SCALE],
  [-2 * CITY_SCALE, -4 * CITY_SCALE],
  [2 * CITY_SCALE, -4 * CITY_SCALE],
  [6 * CITY_SCALE, -4 * CITY_SCALE],
  [-6 * CITY_SCALE, 0],
  [-2 * CITY_SCALE, 0],
  [2 * CITY_SCALE, 0],
  [6 * CITY_SCALE, 0],
  [-6 * CITY_SCALE, 4 * CITY_SCALE],
  [-2 * CITY_SCALE, 4 * CITY_SCALE],
  [2 * CITY_SCALE, 4 * CITY_SCALE],
  [6 * CITY_SCALE, 4 * CITY_SCALE],
];

interface TreeSpec {
  x: number;
  z: number;
  trunkScale: number;
  canopyRadius: number;
  rotationY: number;
  // Variasi bentuk pohon
  treeType: number; // 0=kerucut biasa, 1=kerucut lebar, 2=bundar
}

interface GrassSpec {
  x: number;
  z: number;
  scale: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  color: THREE.Color;
}

const GRASS_COLORS = ["#2f6b2f", "#3d7a3d", "#2a5c2a", "#356b35", "#2d5a2d"].map(
  (c) => new THREE.Color(c)
);

/** Cek apakah posisi (x,z) menimpa zona terlarang */
function isInExclusionZone(x: number, z: number): boolean {
  // 1. Plaza
  if (Math.abs(x) < PLAZA_HALF && Math.abs(z) < PLAZA_HALF) return true;

  // 2. Sidewalk ring
  if (
    Math.abs(x) <= SIDEWALK_RING &&
    Math.abs(z) <= SIDEWALK_RING &&
    (Math.abs(x) > PLAZA_HALF || Math.abs(z) > PLAZA_HALF)
  ) {
    // Di dalam sidewalk tapi di luar plaza — masih terlarang
    return true;
  }

  // 3. Sungai + bank
  if (Math.abs(z - RIVER_Z) < 1.5 * CITY_SCALE && Math.abs(x) < RIVER_X_RANGE) {
    return true;
  }

  // 4. Bangunan (12 titik grid)
  for (const [bx, bz] of BUILDING_POSITIONS) {
    if (Math.abs(x - bx) < BUILDING_HALF_W && Math.abs(z - bz) < BUILDING_HALF_W) {
      return true;
    }
  }

  return false;
}

/** Cek jarak minimum ke pohon lain (avoid overlap) */
function tooCloseToExisting(
  x: number,
  z: number,
  existing: TreeSpec[],
  minDist: number
): boolean {
  for (const t of existing) {
    const dx = x - t.x;
    const dz = z - t.z;
    if (dx * dx + dz * dz < minDist * minDist) return true;
  }
  return false;
}

/** Generate hutan: 1/3 area map, spawning acak + natural */
function generateForest(): TreeSpec[] {
  const rnd = mulberry32(7743);
  const trees: TreeSpec[] = [];

  // Target: 220 pohon, tersebar di area non-exclusion.
  // Area exclusion ≈ plaza (26×26=676) + river (36×3=108) + buildings (~12×9=108) ≈ 892
  // Area total = 40×40×CITY_SCALE², area tersisa ≈ 1600-892 = 708 sq units
  // 1/3 dari total = 533 → butuh ~180-250 pohon (spacing ~2-3 unit antar pohon)

  const MAP_HALF = 19.5 * CITY_SCALE;
  const MIN_TREE_SPACING = 1.8 * CITY_SCALE; // jarak minimum antar pohon

  let guard = 0;
  const maxAttempts = TREE_COUNT * 50;

  while (trees.length < TREE_COUNT && guard < maxAttempts) {
    guard++;

    // Random position di seluruh map
    const x = (rnd() * 2 - 1) * MAP_HALF;
    const z = (rnd() * 2 - 1) * MAP_HALF;

    // Reject jika di zona terlarang
    if (isInExclusionZone(x, z)) continue;

    // Reject jika terlalu dekat pohon lain
    if (tooCloseToExisting(x, z, trees, MIN_TREE_SPACING)) continue;

    // Variasi pohon: tinggi, radius tajuk, tipe
    const treeType = Math.floor(rnd() * 3);
    const trunkScale = 0.8 + rnd() * 0.8; // 0.8–1.6
    const canopyRadius = treeType === 1
      ? 0.9 + rnd() * 0.5 // tipe lebar: 0.9–1.4
      : treeType === 2
      ? 0.5 + rnd() * 0.4 // tipe bundar: 0.5–0.9
      : 0.7 + rnd() * 0.5; // tipe biasa: 0.7–1.2

    trees.push({
      x,
      z,
      trunkScale,
      canopyRadius,
      rotationY: rnd() * Math.PI * 2,
      treeType,
    });
  }

  return trees;
}

/** Generate rumput di area yang tersisa */
function generateGrass(): GrassSpec[] {
  const rnd = mulberry32(2048);
  const blades: GrassSpec[] = [];
  const MAP_HALF = 19.5 * CITY_SCALE;
  let guard = 0;

  while (blades.length < GRASS_COUNT && guard < GRASS_COUNT * 30) {
    guard++;
    const x = (rnd() * 2 - 1) * MAP_HALF;
    const z = (rnd() * 2 - 1) * MAP_HALF;

    if (isInExclusionZone(x, z)) continue;

    blades.push({
      x,
      z,
      scale: 0.5 + rnd() * 0.7,
      rotX: (rnd() - 0.5) * 0.4,
      rotY: rnd() * Math.PI * 2,
      rotZ: (rnd() - 0.5) * 0.4,
      color: GRASS_COLORS[Math.floor(rnd() * GRASS_COLORS.length)],
    });
  }
  return blades;
}

export function Vegetation() {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const canopy1Ref = useRef<THREE.InstancedMesh>(null);
  const canopy2Ref = useRef<THREE.InstancedMesh>(null);
  const canopy3Ref = useRef<THREE.InstancedMesh>(null);
  const grassRef = useRef<THREE.InstancedMesh>(null);

  const trees = useMemo(generateForest, []);
  const grass = useMemo(generateGrass, []);

  // Matriks pohon — SEKALI saat mount
  useLayoutEffect(() => {
    const trunk = trunkRef.current;
    const canopy1 = canopy1Ref.current;
    const canopy2 = canopy2Ref.current;
    const canopy3 = canopy3Ref.current;
    if (!trunk || !canopy1 || !canopy2 || !canopy3) return;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const r = t.canopyRadius;

      // Batang
      dummy.position.set(t.x, t.trunkScale / 2, t.z);
      dummy.rotation.set(0, t.rotationY, 0);
      dummy.scale.set(1, t.trunkScale, 1);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);

      // Tajuk bawah — beda ukuran per tipe
      const bottomScale = t.treeType === 1 ? r * 1.3 : t.treeType === 2 ? r * 1.0 : r * 1.15;
      dummy.position.set(t.x, t.trunkScale + r * 0.35, t.z);
      dummy.rotation.set(0, t.rotationY, 0);
      dummy.scale.set(bottomScale, r * 1.2, bottomScale);
      dummy.updateMatrix();
      canopy1.setMatrixAt(i, dummy.matrix);

      // Tajuk atas
      const topScale = t.treeType === 1 ? r * 0.9 : t.treeType === 2 ? r * 0.7 : r * 0.8;
      dummy.position.set(t.x, t.trunkScale + r * 1.1, t.z);
      dummy.rotation.set(0, t.rotationY + 0.4, 0);
      dummy.scale.set(topScale, r * 0.85, topScale);
      dummy.updateMatrix();
      canopy2.setMatrixAt(i, dummy.matrix);

      // Tajuk paling atas (titik) — untuk kerucut
      const tipScale = t.treeType === 2 ? r * 0.4 : r * 0.5;
      dummy.position.set(t.x, t.trunkScale + r * 1.7, t.z);
      dummy.rotation.set(0, t.rotationY + 0.2, 0);
      dummy.scale.set(tipScale, r * 0.6, tipScale);
      dummy.updateMatrix();
      canopy3.setMatrixAt(i, dummy.matrix);
    }

    trunk.instanceMatrix.needsUpdate = true;
    canopy1.instanceMatrix.needsUpdate = true;
    canopy2.instanceMatrix.needsUpdate = true;
    canopy3.instanceMatrix.needsUpdate = true;
  }, [trees]);

  // Matriks + warna rumput — SEKALI saat mount
  useLayoutEffect(() => {
    const mesh = grassRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < grass.length; i++) {
      const g = grass[i];
      dummy.position.set(g.x, (0.3 * g.scale) / 2, g.z);
      dummy.rotation.set(g.rotX, g.rotY, g.rotZ);
      dummy.scale.set(g.scale * 0.6, g.scale, g.scale * 0.6);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, g.color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [grass]);

  return (
    <group>
      {/* Pohon — 4 InstancedMesh (batang + 3 tajuk layer) */}
      <instancedMesh ref={trunkRef} args={[undefined, undefined, TREE_COUNT]} frustumCulled={false}>
        <cylinderGeometry args={[0.1, 0.13, 1, 5]} />
        <meshStandardMaterial color="#5a4632" roughness={0.95} metalness={0} />
      </instancedMesh>

      <instancedMesh ref={canopy1Ref} args={[undefined, undefined, TREE_COUNT]} frustumCulled={false} castShadow>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial color="#2e5d2e" roughness={1} metalness={0} />
      </instancedMesh>

      <instancedMesh ref={canopy2Ref} args={[undefined, undefined, TREE_COUNT]} frustumCulled={false} castShadow>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial color="#3a7a3a" roughness={1} metalness={0} />
      </instancedMesh>

      <instancedMesh ref={canopy3Ref} args={[undefined, undefined, TREE_COUNT]} frustumCulled={false} castShadow>
        <coneGeometry args={[1, 1, 6]} />
        <meshStandardMaterial color="#4a8a4a" roughness={1} metalness={0} />
      </instancedMesh>

      {/* Rumput */}
      <instancedMesh ref={grassRef} args={[undefined, undefined, GRASS_COUNT]} frustumCulled={false}>
        <boxGeometry args={[0.03, 0.3, 0.03]} />
        <meshStandardMaterial roughness={1} metalness={0} />
      </instancedMesh>
    </group>
  );
}

export default Vegetation;
