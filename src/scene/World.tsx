import { type ReactNode, Component, Suspense } from 'react'
import { useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { GasParticles } from './GasParticles'
import { DataRiver } from './DataRiver'
import { SkyDome } from './SkyDome'
import { Vegetation } from './Vegetation'
import { RooftopDetails } from './BuildingFacade'
import { RoadNetwork } from './RoadNetwork'
import { Traffic } from './Traffic'
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

export function World({ children }: WorldProps) {
  return (
    <>
      <fog attach="fog" args={['#0a0a0f', 20 * CITY_SCALE, 50 * CITY_SCALE]} />

      <ambientLight intensity={0.4} />
      <directionalLight
        intensity={0.8}
        position={[10 * CITY_SCALE, 15 * CITY_SCALE, 5 * CITY_SCALE]}
        castShadow
        // Rescale ×CITY_SCALE: shadow camera harus membingkai kota ±300
        // (grid ±105 + ring pohon ±285). mapSize 1024→2048 menahan ketajaman
        // di span 15× — trade-off fill-rate GPU ~4× per pass shadow.
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
        TANAH rekonstruksi (≤8 draw calls), span ×CITY_SCALE:
        1. Base 600×600 rumput hijau gelap (area di luar kota)
        2. Plaza aspal 390×390 di tengah (grid bangunan ±105)
        3. Sidewalk ring — 4 strip 0.5 mengelilingi plaza
        4. 1 strip jalan tipis di koridor z=-RIVER_Z (koridor +RIVER_Z milik sungai)
        Semua lapisan receiveShadow; gridHelper dihapus (diganti detail nyata).
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40 * CITY_SCALE, 40 * CITY_SCALE]} />
        <meshStandardMaterial color="#1a2418" roughness={1} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, PLAZA_Y, 0]} receiveShadow>
        <planeGeometry args={[PLAZA_SIZE, PLAZA_SIZE]} />
        <meshStandardMaterial color="#1b1d23" roughness={0.95} metalness={0} />
      </mesh>

      {/* Sidewalk ring — 4 strip tipis (draw call 3–6); y SIDEWALK_X_Y/SIDEWALK_Z_Y
          alternate agar pojok yang overlap tidak z-fight */}
      {SIDEWALK_STRIPS.map((s) => (
        <mesh
          key={`sidewalk-${s.x}-${s.z}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[s.x, s.y, s.z]}
          receiveShadow
        >
          <planeGeometry args={s.size} />
          <meshStandardMaterial color="#2a2c33" roughness={0.9} metalness={0} />
        </mesh>
      ))}

      {/* Jalan tipis — 1 strip sejajar x (draw call 7) */}
      {ROAD_STRIPS.map((r) => (
        <mesh
          key={`road-${r.z}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, ROAD_Y, r.z]}
          receiveShadow
        >
          <planeGeometry args={r.size} />
          <meshStandardMaterial color="#23262d" roughness={0.85} metalness={0} />
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

      {/* multisampling 2 (default 8x terlalu berat untuk mid-range @ dpr tinggi) */}
      <EffectComposer multisampling={2}>
        <Bloom
          luminanceThreshold={0.8}
          luminanceSmoothing={0.9}
          intensity={0.5}
        />
        <Vignette offset={0.3} darkness={0.5} />
      </EffectComposer>
    </>
  )
}
