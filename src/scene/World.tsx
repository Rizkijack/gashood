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
 * gridHelper dihapus — diganti plaza + sidewalk + jalan yang nyata. */

// Sidewalk: 4 strip 0.5 tebal mengelilingi plaza 26×26 (x/z ±13 → ±13.5).
// Strip X & Z saling overlap di 4 pojok — diberi y berbeda (0.004/0.005)
// agar tidak z-fight di area pojok.
const SIDEWALK_STRIPS: { x: number; z: number; y: number; size: [number, number] }[] = [
  { x: 0, z: 13.25, y: 0.004, size: [27, 0.5] },
  { x: 0, z: -13.25, y: 0.004, size: [27, 0.5] },
  { x: 13.25, z: 0, y: 0.005, size: [0.5, 27] },
  { x: -13.25, z: 0, y: 0.005, size: [0.5, 27] },
];

// Jalan tipis: 1 strip sejajar sumbu X di z=-2 (koridor antara baris z=-4
// dan z=0). Lebar disamakan ring avenue (1.6) agar menyambung visual dengan
// RoadNetwork — koridor z=2 dipakai sungai DataRiver (road tidak boleh
// bertindihan dengan air/bank, sungai z ∈ [1.09, 2.91]).
const ROAD_STRIPS: { z: number; size: [number, number] }[] = [
  { z: -2, size: [26, 1.6] },
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
      <fog attach="fog" args={['#0a0a0f', 20, 50]} />

      <ambientLight intensity={0.4} />
      <directionalLight
        intensity={0.8}
        position={[10, 15, 5]}
        castShadow
        // GPU churn fix: 2048 → 1024. Kejelasan shadow kota masih memadai
        // pada skala scene 40x40, biaya fill-rate turun ~4x.
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <pointLight position={[-8, 5, -8]} intensity={0.3} color="#4488ff" />
      <pointLight position={[8, 5, 8]} intensity={0.2} color="#ff8844" />

      {/*
        TANAH rekonstruksi (≤8 draw calls):
        1. Base 40×40 rumput hijau gelap (area di luar kota)
        2. Plaza aspal 26×26 di tengah (grid bangunan ±8)
        3. Sidewalk ring — 4 strip 0.5 mengelilingi plaza
        4. 1 strip jalan tipis di koridor z=-2 (koridor z=2 milik sungai)
        Semua lapisan receiveShadow; gridHelper dihapus (diganti detail nyata).
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#1a2418" roughness={1} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[26, 26]} />
        <meshStandardMaterial color="#1b1d23" roughness={0.95} metalness={0} />
      </mesh>

      {/* Sidewalk ring — 4 strip tipis (draw call 3–6); y 0.004/0.005
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
          position={[0, 0.008, r.z]}
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
