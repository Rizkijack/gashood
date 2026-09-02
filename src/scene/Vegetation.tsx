import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/* ---------------------------------------------------------------------------
 * Vegetasi statis GasHood — rumput + pohon perimeter.
 * Semua instancing: geometry/material SATU KALI, matriks di-set SEKALI saat
 * mount (useLayoutEffect). TIDAK ada update per frame. Posisi deterministik
 * (mulberry32 + seed tetap) — susunan tidak berubah antar render.
 * Draw calls: 1 rumput + 1 batang + 2 tajuk = 4 total.
 * ------------------------------------------------------------------------- */

/** PRNG deterministik mulberry32 — pengganti Math.random() agar layout stabil. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TREE_COUNT = 52;
const GRASS_COUNT = 1000;

interface TreeSpec {
  x: number;
  z: number;
  trunkScale: number; // tinggi batang 0.9–1.4
  canopyRadius: number; // radius tajuk 0.7–1.1
  rotationY: number;
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

// Palette rumput: 3 hijau bervariasi (setColorAt per instance).
const GRASS_COLORS = ["#2f6b2f", "#3d7a3d", "#2a5c2a"].map((c) => new THREE.Color(c));

/** Pohon ring perimeter: radius 14.5–19 (di luar plaza 13, sebelum tepi 20).
 * Pohon yang jatuh di jalur sungai (strip |z| < 3.2, sungai z=2 span air+bank
 * [1.09, 2.91] + margin) digeser ke tepian luar sungai (z = ±3.2–3.8). */
function generateTrees(): TreeSpec[] {
  const rnd = mulberry32(42);
  const trees: TreeSpec[] = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    const angle = (i / TREE_COUNT) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
    const radius = 14.5 + rnd() * 4.5;
    let x = Math.cos(angle) * radius;
    let z = Math.sin(angle) * radius;
    // Hindari tumbuh di atas air/bank sungai (z=2) — geser ke tepian luar.
    if (Math.abs(z) < 3.2 && Math.abs(x) < 18) {
      z = z < 0 ? -(3.2 + rnd() * 0.6) : 3.2 + rnd() * 0.6;
    }
    trees.push({
      x,
      z,
      trunkScale: 0.9 + rnd() * 0.5,
      canopyRadius: 0.7 + rnd() * 0.4,
      rotationY: rnd() * Math.PI * 2,
    });
  }
  return trees;
}

/** Rumput: rejection sampling di ring 12.5–19.5. Urutan tolak:
 * 1) plaza (jarak < 12.5), 2) sungai (strip |z| < 3.2 dalam rentang x ±18),
 * 3) sidewalk/square kota (|x| ≤ 13.5 && |z| ≤ 13.5 — plaza 26×26 + ring
 * sidewalk ±13.25, plus toleransi 0.25) → rumput hanya di luar bangunan
 * dan tidak menembus sidewalk. */
function generateGrass(): GrassSpec[] {
  const rnd = mulberry32(1337);
  const blades: GrassSpec[] = [];
  let guard = 0;
  while (blades.length < GRASS_COUNT && guard < GRASS_COUNT * 40) {
    guard++;
    const x = (rnd() * 2 - 1) * 19.5;
    const z = (rnd() * 2 - 1) * 19.5;
    const dist = Math.hypot(x, z);
    if (dist < 12.5) continue; // 1) plaza aspal
    if (dist > 19.5) continue; // ring rumput
    if (Math.abs(z) < 3.2 && Math.abs(x) < 18) continue; // 2) jalur sungai z=2
    if (Math.abs(x) <= 13.5 && Math.abs(z) <= 13.5) continue; // 3) sidewalk kota
    blades.push({
      x,
      z,
      scale: 0.7 + rnd() * 0.8,
      rotX: (rnd() - 0.5) * 0.5,
      rotY: rnd() * Math.PI * 2,
      rotZ: (rnd() - 0.5) * 0.5,
      color: GRASS_COLORS[Math.floor(rnd() * GRASS_COLORS.length)],
    });
  }
  return blades;
}

export function Vegetation() {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const canopy1Ref = useRef<THREE.InstancedMesh>(null);
  const canopy2Ref = useRef<THREE.InstancedMesh>(null);
  const grassRef = useRef<THREE.InstancedMesh>(null);

  const trees = useMemo(generateTrees, []);
  const grass = useMemo(generateGrass, []);

  // Matriks instans pohon di-set SEKALI saat mount — statis, tanpa per frame.
  useLayoutEffect(() => {
    const trunk = trunkRef.current;
    const canopy1 = canopy1Ref.current;
    const canopy2 = canopy2Ref.current;
    if (!trunk || !canopy1 || !canopy2) return;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const r = t.canopyRadius;

      // Batang — cylinder tipis (unit, skala tinggi per instance).
      dummy.position.set(t.x, t.trunkScale / 2, t.z);
      dummy.rotation.set(0, t.rotationY, 0);
      dummy.scale.set(1, t.trunkScale, 1);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);

      // Tajuk bawah — kerucut lebar (#2e5d2e).
      dummy.position.set(t.x, t.trunkScale + r * 0.4, t.z);
      dummy.rotation.set(0, t.rotationY, 0);
      dummy.scale.set(r * 1.15, r * 1.25, r * 1.15);
      dummy.updateMatrix();
      canopy1.setMatrixAt(i, dummy.matrix);

      // Tajuk atas — kerucut lebih kecil (#3a7a3a), tinggi total ~2.2–3.2.
      dummy.position.set(t.x, t.trunkScale + r * 1.15, t.z);
      dummy.rotation.set(0, t.rotationY + 0.4, 0);
      dummy.scale.set(r * 0.8, r * 0.9, r * 0.8);
      dummy.updateMatrix();
      canopy2.setMatrixAt(i, dummy.matrix);
    }

    trunk.instanceMatrix.needsUpdate = true;
    canopy1.instanceMatrix.needsUpdate = true;
    canopy2.instanceMatrix.needsUpdate = true;
  }, [trees]);

  // Matriks + warna rumput (setColorAt) di-set SEKALI saat mount.
  useLayoutEffect(() => {
    const mesh = grassRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < grass.length; i++) {
      const g = grass[i];
      // y = tinggi blade / 2 → pangkal blade menempel tanah.
      dummy.position.set(g.x, (0.35 * g.scale) / 2, g.z);
      dummy.rotation.set(g.rotX, g.rotY, g.rotZ);
      dummy.scale.set(g.scale * 0.8, g.scale, g.scale * 0.8);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, g.color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [grass]);

  return (
    <group>
      {/* Pohon — 3 InstancedMesh (batang + 2 tajuk). frustumCulled=false karena
          bounding sphere geometry unit tidak mewakili sebaran instans. */}
      <instancedMesh ref={trunkRef} args={[undefined, undefined, TREE_COUNT]} frustumCulled={false}>
        <cylinderGeometry args={[0.12, 0.14, 1, 5]} />
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

      {/* Rumput — 1 InstancedMesh 1000 blade, warna via setColorAt (3 hijau).
          castShadow/receiveShadow false (murah). CATATAN: TANPA prop
          vertexColors — boxGeometry tidak punya attribute `color`, sehingga
          USE_COLOR membuat vColor *= color(0,0,0) dan meredam instanceColor
          (rumput jadi hitam). setColorAt bekerja via USE_INSTANCING_COLOR
          yang independen dari vertexColors. */}
      <instancedMesh ref={grassRef} args={[undefined, undefined, GRASS_COUNT]} frustumCulled={false}>
        <boxGeometry args={[0.04, 0.35, 0.04]} />
        <meshStandardMaterial roughness={1} metalness={0} />
      </instancedMesh>
    </group>
  );
}

export default Vegetation;
