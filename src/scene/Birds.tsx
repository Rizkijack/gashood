import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { useGasStore } from "@/store/gas-store"
import { CITY_SCALE } from "./layout"

/* ---------------------------------------------------------------------------
 * Birds — kawanan burung berterbangan di sekitar kota.
 *
 * Konsep:
 * - 30 burung InstancedMesh (2 draw call: body + sayap).
 * - Terbang dalam formasi V atau flock random.
 * - Kecepatan & ketinggian berubah mengikuti TPS (lebih ramai = lebih aktif).
 * - Sayap bergerak naik-turun (flap) per frame.
 * - Warna gelap (siluet) agar terlihat realistis.
 * - Performance: InstancedMesh, 0 alokasi per frame.
 * ------------------------------------------------------------------------- */

const BIRD_COUNT = 30

/** PRNG deterministik */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface BirdSpec {
  /** Radius orbit dari pusat kota */
  orbitRadius: number
  /** Ketinggian dasar */
  baseHeight: number
  /** Kecepatan angular */
  angularSpeed: number
  /** Offset sudut awal */
  startAngle: number
  /** Amplitudo naik-turun */
  bobAmplitude: number
  /** Frekuensi bob */
  bobFrequency: number
  /** Formasi: offset dari leader */
  formationOffset: [number, number, number]
  /** Apakah ini leader flock */
  isLeader: boolean
}

function generateBirds(): BirdSpec[] {
  const rnd = mulberry32(20260906)
  const birds: BirdSpec[] = []

  // 3 flock, masing-masing 10 burung
  for (let f = 0; f < 3; f++) {
    const flockRadius = (20 + f * 15) * CITY_SCALE
    const flockHeight = (15 + f * 8) * CITY_SCALE
    const flockSpeed = 0.2 + f * 0.05
    const flockAngle = (f / 3) * Math.PI * 2

    for (let i = 0; i < 10; i++) {
      const isLeader = i === 0
      // Formasi V: leader di depan, follower di belakang kiri/kanan
      const row = Math.floor((i - 1) / 2)
      const side = i % 2 === 0 ? 1 : -1
      const formationX = isLeader ? 0 : -row * 1.5 * CITY_SCALE
      const formationY = isLeader ? 0 : -row * 0.3 * CITY_SCALE
      const formationZ = isLeader ? 0 : side * 1.2 * CITY_SCALE

      birds.push({
        orbitRadius: flockRadius + rnd() * 5 * CITY_SCALE,
        baseHeight: flockHeight + rnd() * 3 * CITY_SCALE,
        angularSpeed: flockSpeed + (rnd() - 0.5) * 0.03,
        startAngle: flockAngle + rnd() * 0.3,
        bobAmplitude: 0.5 + rnd() * 0.5,
        bobFrequency: 2 + rnd() * 1,
        formationOffset: [formationX, formationY, formationZ],
        isLeader,
      })
    }
  }
  return birds
}

export function Birds() {
  const bodyRef = useRef<THREE.InstancedMesh>(null)
  const wingRef = useRef<THREE.InstancedMesh>(null)

  const birds = useMemo(generateBirds, [])

  // Geometri — dibuat sekali
  const assets = useMemo(() => {
    // Body burung: spindle shape (stretched sphere)
    const bodyGeo = new THREE.ConeGeometry(0.15, 0.8, 4)
    bodyGeo.rotateX(Math.PI / 2)
    bodyGeo.translate(0, 0, 0)

    // Sayap: thin box yang bergerak naik-turun
    const wingGeo = new THREE.BoxGeometry(1.2, 0.03, 0.3)
    wingGeo.translate(0, 0, 0)

    const bodyMat = new THREE.MeshStandardMaterial({
      color: "#2A2A2A",
      roughness: 0.8,
      metalness: 0.2,
    })

    const wingMat = new THREE.MeshStandardMaterial({
      color: "#3A3A3A",
      roughness: 0.7,
      metalness: 0.1,
    })

    return { bodyGeo, wingGeo, bodyMat, wingMat }
  }, [])

  // Pose per-frame
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const wingDummy = useMemo(() => new THREE.Object3D(), [])

  // Flap state per burung
  const flapPhases = useMemo(() => birds.map(() => Math.random() * Math.PI * 2), [birds])

  // TPS untuk modulasi kecepatan
  const tps = useGasStore((s) => s.networkStats.tps)

  useFrame((state) => {
    const body = bodyRef.current
    const wing = wingRef.current
    if (!body || !wing) return

    const safeTps = Number.isFinite(tps) ? tps : 0
    const tpsFactor = 1 + Math.min(safeTps / 20, 0.5) // max 1.5x

    const time = state.clock.elapsedTime

    for (let i = 0; i < birds.length; i++) {
      const b = birds[i]

      // Update angle (orbital motion)
      const currentAngle = b.startAngle + time * b.angularSpeed * tpsFactor

      // Posisi dasar
      let x = Math.cos(currentAngle) * b.orbitRadius + b.formationOffset[0]
      let z = Math.sin(currentAngle) * b.orbitRadius + b.formationOffset[2]
      let y = b.baseHeight + Math.sin(time * b.bobFrequency + flapPhases[i]) * b.bobAmplitude * CITY_SCALE + b.formationOffset[1]

      // Body
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, -currentAngle + Math.PI / 2, 0)
      dummy.scale.set(0.8, 0.8, 0.8)
      dummy.updateMatrix()
      body.setMatrixAt(i, dummy.matrix)

      // Sayap — flapping naik-turun
      const flapAngle = Math.sin(time * 8 + flapPhases[i]) * 0.4
      wingDummy.position.set(x, y, z)
      wingDummy.rotation.set(0, -currentAngle + Math.PI / 2, flapAngle)
      wingDummy.scale.set(0.8, 0.8, 0.8)
      wingDummy.updateMatrix()
      wing.setMatrixAt(i, wingDummy.matrix)
    }

    body.instanceMatrix.needsUpdate = true
    wing.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[assets.bodyGeo, assets.bodyMat, BIRD_COUNT]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={wingRef}
        args={[assets.wingGeo, assets.wingMat, BIRD_COUNT]}
        frustumCulled={false}
      />
    </group>
  )
}

export default Birds
