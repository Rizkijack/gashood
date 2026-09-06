import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { useGasStore } from "@/store/gas-store"
import { CITY_SCALE } from "./layout"

/* ---------------------------------------------------------------------------
 * Railway — rel kereta api melintasi kota.
 *
 * Konsep:
 * - 2 jalur rel sejajar sumbu X di z = -5 × CITY_SCALE (di antara jalan).
 * - Rel baja (4 rail: 2 main + 2 guard) di atas bantalan (sleeper) beton.
 * - Kereta api InstancedMesh melintas periodik (1 kereta, 6 gerbong).
 * - Kecepatan kereta mengikuti TPS (lebih ramai = lebih sering lewat).
 * - Sound design sengaja di-skip (fase ini visual only).
 * - Performance: merged geometries untuk rel, InstancedMesh untuk gerbong.
 * ------------------------------------------------------------------------- */

const RAIL_Z = -5 * CITY_SCALE // posisi z jalur rel
const RAIL_LENGTH = 60 * CITY_SCALE // panjang rel melintang
const RAIL_HEIGHT = 0.08 // tinggi rel di atas bantalan
const SLEEPER_SPACING = 1.2 // jarak antar bantalan (skala mobil)
const TRACK_GAUGE = 1.0 // lebar rel (jarak antar rail utama)
const GUARD_OFFSET = 0.55 // offset rail pengaman dari utama

// Kereta api
const TRAIN_SPEED = 8 // unit/s
const CAR_COUNT = 6
const CAR_LENGTH = 2.5
const CAR_SPACING = 0.3
const CAR_WIDTH = 0.6
const CAR_HEIGHT = 0.45

/** Tekstur bantalan beton */
function makeSleeperTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas")
  c.width = 64
  c.height = 64
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#5a5d64"
  ctx.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 400; i++) {
    const v = 70 + Math.floor(Math.random() * 20)
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 5},${0.08 + Math.random() * 0.1})`
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function Railway() {
  const tps = useGasStore((s) => s.networkStats.tps)

  const assets = useMemo(() => {
    // Rel baja (rail): box tipis panjang
    const railMat = new THREE.MeshStandardMaterial({
      color: "#8a8d94",
      roughness: 0.3,
      metalness: 0.8,
    })

    // Bantalan beton (sleeper): box pendek melintang
    const sleeperMat = new THREE.MeshStandardMaterial({
      map: makeSleeperTexture(),
      roughness: 0.9,
      metalness: 0,
    })

    // Ballast (kerikil): box gelap di bawah
    const ballastMat = new THREE.MeshStandardMaterial({
      color: "#3a3d44",
      roughness: 1,
      metalness: 0,
    })

    // Kereta
    const carMat = new THREE.MeshStandardMaterial({
      color: "#E8E8E8",
      roughness: 0.4,
      metalness: 0.5,
    })

    const roofMat = new THREE.MeshStandardMaterial({
      color: "#C0C0C0",
      roughness: 0.3,
      metalness: 0.6,
    })

    const windowMat = new THREE.MeshStandardMaterial({
      color: "#4A90D9",
      roughness: 0.1,
      metalness: 0.8,
    })

    const wheelMat = new THREE.MeshStandardMaterial({
      color: "#2A2A2A",
      roughness: 0.5,
      metalness: 0.7,
    })

    return { railMat, sleeperMat, ballastMat, carMat, roofMat, windowMat, wheelMat }
  }, [])

  // Geometri statis (rel + bantalan + ballast)
  const staticGeo = useMemo(() => {
    const railParts: THREE.BufferGeometry[] = []
    const sleeperParts: THREE.BufferGeometry[] = []
    const ballastParts: THREE.BufferGeometry[] = []

    // 4 rel sejajar (2 utama + 2 guard)
    const railPositions = [
      -TRACK_GAUGE / 2,
      TRACK_GAUGE / 2,
      -GUARD_OFFSET,
      GUARD_OFFSET,
    ]

    for (const offset of railPositions) {
      const rail = new THREE.BoxGeometry(0.04, RAIL_HEIGHT, RAIL_LENGTH)
      rail.translate(offset, RAIL_HEIGHT / 2, RAIL_Z)
      railParts.push(rail)
    }

    // Bantalan (sleeper) melintang
    const numSleepers = Math.floor(RAIL_LENGTH / SLEEPER_SPACING)
    for (let i = 0; i < numSleepers; i++) {
      const x = -RAIL_LENGTH / 2 + i * SLEEPER_SPACING
      const sleeper = new THREE.BoxGeometry(TRACK_GAUGE + 0.4, 0.06, 0.15)
      sleeper.translate(x, 0.03, RAIL_Z)
      sleeperParts.push(sleeper)
    }

    // Ballast (kerikil dasar)
    const ballast = new THREE.BoxGeometry(TRACK_GAUGE + 0.6, 0.1, RAIL_LENGTH)
    ballast.translate(0, -0.05, RAIL_Z)
    ballastParts.push(ballast)

    const rails = mergeGeometries(railParts, false)!
    railParts.forEach((g) => g.dispose())

    const sleepers = mergeGeometries(sleeperParts, false)!
    sleeperParts.forEach((g) => g.dispose())

    const ballastGeo = mergeGeometries(ballastParts, false)!
    ballastParts.forEach((g) => g.dispose())

    return { rails, sleepers, ballast: ballastGeo }
  }, [])

  // Kereta (InstancedMesh)
  const trainRef = useRef<THREE.Group>(null)
  const trainXRef = useRef(-RAIL_LENGTH / 2 - CAR_COUNT * (CAR_LENGTH + CAR_SPACING))

  // Geometri gerbong
  const trainGeo = useMemo(() => {
    const carGeo = new THREE.BoxGeometry(CAR_WIDTH, CAR_HEIGHT, CAR_LENGTH)
    const roofGeo = new THREE.BoxGeometry(CAR_WIDTH + 0.05, 0.08, CAR_LENGTH + 0.05)
    const windowGeo = new THREE.BoxGeometry(CAR_WIDTH + 0.01, 0.12, 0.3)
    const wheelGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8)

    return { carGeo, roofGeo, windowGeo, wheelGeo }
  }, [])

  useFrame((_, delta) => {
    if (!trainRef.current) return

    const safeTps = Number.isFinite(tps) ? tps : 0
    // Kereta bergerak lebih cepat saat TPS tinggi
    const speed = TRAIN_SPEED * (1 + Math.min(safeTps / 15, 1))

    trainXRef.current += speed * delta

    // Loop: kereta keluar di ujung kanan, muncul lagi di kiri
    const totalLength = CAR_COUNT * (CAR_LENGTH + CAR_SPACING)
    if (trainXRef.current > RAIL_LENGTH / 2 + totalLength) {
      trainXRef.current = -RAIL_LENGTH / 2 - totalLength
    }

    // Update posisi setiap gerbong
    const dummy = new THREE.Object3D()
    const train = trainRef.current

    for (let i = 0; i < CAR_COUNT; i++) {
      const x = trainXRef.current + i * (CAR_LENGTH + CAR_SPACING)
      dummy.position.set(x, RAIL_HEIGHT + 0.25, RAIL_Z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()

      // Car body
      const car = train.children[i * 4] as THREE.Mesh
      if (car) car.matrix.copy(dummy.matrix)

      // Roof
      dummy.position.y = RAIL_HEIGHT + CAR_HEIGHT / 2 + 0.04
      dummy.updateMatrix()
      const roof = train.children[i * 4 + 1] as THREE.Mesh
      if (roof) roof.matrix.copy(dummy.matrix)

      // Windows (kiri)
      dummy.position.set(x, RAIL_HEIGHT + 0.35, RAIL_Z - CAR_WIDTH / 2)
      dummy.updateMatrix()
      const windowL = train.children[i * 4 + 2] as THREE.Mesh
      if (windowL) windowL.matrix.copy(dummy.matrix)

      // Windows (kanan)
      dummy.position.z = RAIL_Z + CAR_WIDTH / 2
      dummy.updateMatrix()
      const windowR = train.children[i * 4 + 3] as THREE.Mesh
      if (windowR) windowR.matrix.copy(dummy.matrix)
    }

    // Mark matrices needsUpdate
    for (const child of train.children) {
      if (child instanceof THREE.Mesh) {
        child.updateMatrix()
      }
    }
  })

  return (
    <group>
      {/* Rel + bantalan + ballast — merged, 3 draw call */}
      <mesh geometry={staticGeo.rails} material={assets.railMat} castShadow />
      <mesh geometry={staticGeo.sleepers} material={assets.sleeperMat} receiveShadow />
      <mesh geometry={staticGeo.ballast} material={assets.ballastMat} receiveShadow />

      {/* Kereta — 6 gerbong */}
      <group ref={trainRef}>
        {Array.from({ length: CAR_COUNT }).map((_, i) => (
          <group key={i}>
            <mesh
              geometry={trainGeo.carGeo}
              material={assets.carMat}
              matrixAutoUpdate={false}
              castShadow
            />
            <mesh
              geometry={trainGeo.roofGeo}
              material={assets.roofMat}
              matrixAutoUpdate={false}
            />
            <mesh
              geometry={trainGeo.windowGeo}
              material={assets.windowMat}
              matrixAutoUpdate={false}
            />
            <mesh
              geometry={trainGeo.windowGeo}
              material={assets.windowMat}
              matrixAutoUpdate={false}
            />
          </group>
        ))}
      </group>
    </group>
  )
}

export default Railway
