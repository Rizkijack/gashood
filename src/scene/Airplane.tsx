import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { CITY_SCALE } from "./layout"

/* ---------------------------------------------------------------------------
 * Airplane — pesawat terbang melintasi langit kota.
 *
 * Konsep:
 * - 3 pesawat terbang di lintasan berbeda (orbit elips di ketinggian tinggi).
 * - Kecepatan tetap (tidak berubah dengan TPS).
 * - Bayangan awan (contrail) tipis di belakang pesawat.
 * - Warna putih/abu-abu, body sederhana (box + sayap).
 * - Muncul secara periodik (tidak selalu terlihat).
 * ------------------------------------------------------------------------- */

interface AirplaneSpec {
  orbitRadius: number
  orbitHeight: number
  speed: number
  startAngle: number
  tilt: number
}

function generateAirplanes(): AirplaneSpec[] {
  return [
    { orbitRadius: 55 * CITY_SCALE, orbitHeight: 35 * CITY_SCALE, speed: 0.15, startAngle: 0, tilt: 0.05 },
    { orbitRadius: 70 * CITY_SCALE, orbitHeight: 40 * CITY_SCALE, speed: 0.12, startAngle: Math.PI * 0.7, tilt: -0.03 },
    { orbitRadius: 45 * CITY_SCALE, orbitHeight: 30 * CITY_SCALE, speed: 0.18, startAngle: Math.PI * 1.4, tilt: 0.08 },
  ]
}

/** Satu pesawat — body + sayap + tail, compact box geometry */
function AirplaneModel({ spec }: { spec: AirplaneSpec; index: number }) {
  const groupRef = useRef<THREE.Group>(null)
  const angleRef = useRef(spec.startAngle)

  // Geometri pesawat — dibuat sekali
  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1.2, 0.4, 4), [])
  const wingGeo = useMemo(() => new THREE.BoxGeometry(6, 0.08, 1.2), [])
  const tailGeo = useMemo(() => new THREE.BoxGeometry(0.08, 1.2, 1.5), [])
  const engineGeo = useMemo(() => new THREE.CylinderGeometry(0.12, 0.12, 0.8, 6), [])

  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#E8E8E8",
    roughness: 0.3,
    metalness: 0.6,
  }), [])

  const wingMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#D0D0D0",
    roughness: 0.4,
    metalness: 0.5,
  }), [])

  const engineMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#888888",
    roughness: 0.2,
    metalness: 0.8,
  }), [])

  // Contrail (awan tipis)
  const trailRef = useRef<THREE.Mesh>(null)
  const trailGeo = useMemo(() => new THREE.BoxGeometry(0.05, 0.05, 20), [])
  const trailMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#FFFFFF",
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  }), [])

  useFrame((_, delta) => {
    if (!groupRef.current) return

    angleRef.current += spec.speed * delta
    const angle = angleRef.current

    const x = Math.cos(angle) * spec.orbitRadius
    const z = Math.sin(angle) * spec.orbitRadius
    const y = spec.orbitHeight + Math.sin(angle * 2) * 2 * CITY_SCALE

    groupRef.current.position.set(x, y, z)

    // Hadap arah gerak + sedikit tilt
    groupRef.current.rotation.y = -angle + Math.PI / 2
    groupRef.current.rotation.z = spec.tilt * Math.sin(angle * 3)

    // Contrail mengikuti pesawat
    if (trailRef.current) {
      trailRef.current.position.set(x, y, z)
      trailRef.current.rotation.y = -angle + Math.PI / 2
    }
  })

  return (
    <group>
      <group ref={groupRef}>
        {/* Body */}
        <mesh geometry={bodyGeo} material={bodyMat} castShadow />
        {/* Sayap */}
        <mesh geometry={wingGeo} material={wingMat} position={[0, 0, 0]} castShadow />
        {/* Tail */}
        <mesh geometry={tailGeo} material={wingMat} position={[0, 0.6, -1.5]} />
        {/* Engine kiri */}
        <mesh geometry={engineGeo} material={engineMat} position={[-1.8, -0.1, 0.5]} rotation={[0, 0, Math.PI / 2]} />
        {/* Engine kanan */}
        <mesh geometry={engineGeo} material={engineMat} position={[1.8, -0.1, 0.5]} rotation={[0, 0, Math.PI / 2]} />
      </group>
      {/* Contrail */}
      <mesh
        ref={trailRef}
        geometry={trailGeo}
        material={trailMat}
        position={[0, spec.orbitHeight, 0]}
      />
    </group>
  )
}

export function Airplane() {
  const airplanes = useMemo(generateAirplanes, [])

  return (
    <group>
      {airplanes.map((spec, i) => (
        <AirplaneModel key={i} spec={spec} index={i} />
      ))}
    </group>
  )
}

export default Airplane
