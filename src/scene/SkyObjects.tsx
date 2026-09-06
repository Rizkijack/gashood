import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { CITY_SCALE } from "./layout"

/* ---------------------------------------------------------------------------
 * SkyObjects — matahari (siang) dan bulan (malam) dengan siklus day/night.
 *
 * Konsep:
 * - Siklus berputar berdasarkan waktu nyata (jam server → posisi di orbit).
 * - Matahari = sphere kuning terang + directional light yang mengikutinya.
 * - Bulan = sphere abu-abu + point light lembut.
 * - Transisi halus: matahari turun → bulan naik, langit berubah warna.
 * - Performance: semua geometry dibuat sekali, useFrame hanya update posisi.
 * ------------------------------------------------------------------------- */

/** Matahari */
function Sun() {
  const meshRef = useRef<THREE.Mesh>(null)
  const lightRef = useRef<THREE.DirectionalLight>(null)
  const glowRef = useRef<THREE.Mesh>(null)

  const sunGeo = useMemo(() => new THREE.SphereGeometry(3 * CITY_SCALE, 16, 16), [])
  const sunMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#FFD700" }), [])
  const glowGeo = useMemo(() => new THREE.SphereGeometry(4.5 * CITY_SCALE, 16, 16), [])
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#FFA500",
    transparent: true,
    opacity: 0.3,
  }), [])

  useFrame(() => {
    if (!meshRef.current || !lightRef.current || !glowRef.current) return

    // Siklus berdasarkan waktu nyata (jam lokal)
    const now = new Date()
    const hours = now.getHours() + now.getMinutes() / 60
    // Matahari terlihat jam 6-18 (siang)
    const sunAngle = ((hours - 6) / 12) * Math.PI // 0 di horizon tenggara, PI di barat
    const sunHeight = Math.sin(sunAngle) * 40 * CITY_SCALE
    const sunX = Math.cos(sunAngle) * 60 * CITY_SCALE
    const sunZ = -30 * CITY_SCALE

    meshRef.current.position.set(sunX, Math.max(sunHeight, -5), sunZ)
    glowRef.current.position.copy(meshRef.current.position)
    lightRef.current.position.set(sunX, Math.max(sunHeight, 10), sunZ)

    // Intensitas mengikuti ketinggian matahari
    const dayFactor = Math.max(0, Math.sin(sunAngle))
    lightRef.current.intensity = 0.8 * dayFactor
    sunMat.opacity = dayFactor
    glowMat.opacity = 0.3 * dayFactor
  })

  return (
    <group>
      <mesh ref={meshRef} geometry={sunGeo} material={sunMat} />
      <mesh ref={glowRef} geometry={glowGeo} material={glowMat} />
      <directionalLight
        ref={lightRef}
        intensity={0.8}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={100 * CITY_SCALE}
        shadow-camera-left={-30 * CITY_SCALE}
        shadow-camera-right={30 * CITY_SCALE}
        shadow-camera-top={30 * CITY_SCALE}
        shadow-camera-bottom={-30 * CITY_SCALE}
      />
    </group>
  )
}

/** Bulan */
function Moon() {
  const meshRef = useRef<THREE.Mesh>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const craterRefs = useRef<THREE.Mesh[]>([])

  const moonGeo = useMemo(() => new THREE.SphereGeometry(2 * CITY_SCALE, 16, 16), [])
  const moonMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#E8E8E8",
    roughness: 0.8,
    metalness: 0.1,
    emissive: "#CCCCCC",
    emissiveIntensity: 0.3,
  }), [])

  // Kawah bulan (decorative)
  const craterPositions = useMemo(() => [
    { pos: [0.5, 0.8, 1.5] as [number, number, number], scale: 0.3 },
    { pos: [-0.8, 0.3, 1.6] as [number, number, number], scale: 0.25 },
    { pos: [0.2, -0.5, 1.7] as [number, number, number], scale: 0.2 },
    { pos: [-0.3, 0.9, 1.4] as [number, number, number], scale: 0.15 },
  ], [])

  const craterGeo = useMemo(() => new THREE.SphereGeometry(1, 8, 8), [])
  const craterMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#BBBBBB",
    roughness: 1,
    metalness: 0,
  }), [])

  useFrame(() => {
    if (!meshRef.current || !lightRef.current) return

    const now = new Date()
    const hours = now.getHours() + now.getMinutes() / 60
    // Bulan terlihat jam 18-6 (malam)
    const moonAngle = ((hours - 18) / 12) * Math.PI
    const moonHeight = Math.sin(moonAngle) * 35 * CITY_SCALE
    const moonX = Math.cos(moonAngle) * 50 * CITY_SCALE
    const moonZ = -25 * CITY_SCALE

    meshRef.current.position.set(moonX, Math.max(moonHeight, -5), moonZ)
    lightRef.current.position.copy(meshRef.current.position)

    // Intensitas mengikuti ketinggian bulan
    const nightFactor = Math.max(0, Math.sin(moonAngle))
    lightRef.current.intensity = 0.15 * nightFactor
    moonMat.emissiveIntensity = 0.3 * nightFactor
  })

  return (
    <group>
      <mesh ref={meshRef} geometry={moonGeo} material={moonMat}>
        {craterPositions.map((c, i) => (
          <mesh
            key={i}
            ref={(el) => { if (el) craterRefs.current[i] = el }}
            geometry={craterGeo}
            material={craterMat}
            position={c.pos}
            scale={c.scale}
          />
        ))}
      </mesh>
      <pointLight ref={lightRef} intensity={0.15} color="#CCCCFF" distance={100 * CITY_SCALE} />
    </group>
  )
}

/** Bintang-bintang kecil */
function Stars() {
  const pointsRef = useRef<THREE.Points>(null)

  const [positions, sizes] = useMemo(() => {
    const count = 200
    const pos = new Float32Array(count * 3)
    const sz = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      // Distribusi spherical di jarak jauh
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = 80 + Math.random() * 40
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta) * CITY_SCALE
      pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * CITY_SCALE + 10 // selalu di atas
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) * CITY_SCALE
      sz[i] = 0.5 + Math.random() * 1.5
    }
    return [pos, sz]
  }, [])

  useFrame(() => {
    if (!pointsRef.current) return
    const now = new Date()
    const hours = now.getHours() + now.getMinutes() / 60
    // Bintang terlihat malam hari (jam 19-5)
    const nightFactor = hours >= 19 || hours < 5 ? 1
      : hours >= 5 && hours < 7 ? 1 - (hours - 5) / 2
      : hours >= 17 && hours < 19 ? (hours - 17) / 2
      : 0
    const mat = pointsRef.current.material
    if (Array.isArray(mat)) {
      mat.forEach(m => { m.opacity = nightFactor * 0.8 })
    } else {
      mat.opacity = nightFactor * 0.8
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#FFFFFF"
        size={1.5}
        sizeAttenuation
        transparent
        opacity={0}
        depthWrite={false}
      />
    </points>
  )
}

export function SkyObjects() {
  return (
    <group>
      <Sun />
      <Moon />
      <Stars />
    </group>
  )
}

export default SkyObjects
