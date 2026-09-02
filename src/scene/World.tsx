import { type ReactNode, Component, Suspense } from 'react'
import { useThree } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { GasParticles } from './GasParticles'
import { DataRiver } from './DataRiver'
import { SkyDome } from './SkyDome'

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

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0a0a0f" roughness={0.8} metalness={0.1} />
      </mesh>
      <gridHelper args={[40, 40, '#1a1a2e', '#111122']} position={[0, 0.01, 0]} />

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
