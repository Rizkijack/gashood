import { useMemo } from "react"
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { CITY_SCALE } from "./layout"

/* ---------------------------------------------------------------------------
 * ElevatedHighway — jalan tol layang melintasi kota.
 *
 * Konsep:
 * - 2 jalur tol layang di ketinggian (y = 6-8 × CITY_SCALE).
 * - Melintang sumbu X di z = -SPACING/2 dan z = -SPACING (mirror jalan bawah).
 * - Tiang penyangga (piaster) vertikal setiap 20 unit.
 * - Dek beton dengan barrier/pagar.
 * - Lampu jalan di atas barrier.
 * - Performance: merged geometries, 1 draw call per jalur.
 * ------------------------------------------------------------------------- */

const DECK_Y = 7 * CITY_SCALE // ketinggian dek
const DECK_WIDTH = 2.0 // lebar dek (3 lajur)
const DECK_LENGTH = 30 * CITY_SCALE // panjang melintang
const BARRIER_HEIGHT = 0.3
const BARRIER_THICK = 0.08
const PILLAR_SPACING = 15 * CITY_SCALE // jarak antar tiang
const PILLAR_WIDTH = 0.4

// Posisi 2 jalur tol layang
const FLYOVER_POSITIONS = [
  { z: -8 * CITY_SCALE, rotation: 0 }, // jalur barat-timur
  { z: -12 * CITY_SCALE, rotation: Math.PI / 2 }, // jalur utara-selatan (crossing)
]

/** Tekstur beton untuk dek */
function makeConcreteTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas")
  c.width = 128
  c.height = 128
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#3a3d44"
  ctx.fillRect(0, 0, 128, 128)
  // Grain beton
  for (let i = 0; i < 800; i++) {
    const v = 45 + Math.floor(Math.random() * 20)
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 5},${0.08 + Math.random() * 0.1})`
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function ElevatedHighway() {
  const assets = useMemo(() => {
    const concreteMat = new THREE.MeshStandardMaterial({
      map: makeConcreteTexture(),
      roughness: 0.85,
      metalness: 0.05,
    })

    const barrierMat = new THREE.MeshStandardMaterial({
      color: "#5a5d64",
      roughness: 0.7,
      metalness: 0.2,
    })

    const pillarMat = new THREE.MeshStandardMaterial({
      color: "#4a4d54",
      roughness: 0.9,
      metalness: 0,
    })

    const lampMat = new THREE.MeshBasicMaterial({ color: "#FFD700" })

    const deckGeo = new THREE.BoxGeometry(DECK_WIDTH, 0.25, DECK_LENGTH)
    const barrierGeo = new THREE.BoxGeometry(BARRIER_THICK, BARRIER_HEIGHT, DECK_LENGTH)
    const pillarGeo = new THREE.BoxGeometry(PILLAR_WIDTH, DECK_Y, PILLAR_WIDTH)
    const lampGeo = new THREE.SphereGeometry(0.08, 6, 6)

    return { concreteMat, barrierMat, pillarMat, lampMat, deckGeo, barrierGeo, pillarGeo, lampGeo }
  }, [])

  // Geometri merged untuk setiap jalur
  const geos = useMemo(() => {
    const results: { deck: THREE.BufferGeometry; barrier: THREE.BufferGeometry; pillars: THREE.BufferGeometry; lamps: THREE.BufferGeometry }[] = []

    for (const pos of FLYOVER_POSITIONS) {
      // Dek
      const deck = assets.deckGeo.clone()
      deck.rotateY(pos.rotation)

      // Barrier kiri & kanan
      const barrierL = assets.barrierGeo.clone()
      barrierL.rotateY(pos.rotation)
      const barrierR = assets.barrierGeo.clone()
      barrierR.rotateY(pos.rotation)

      // Pilar
      const pillarParts: THREE.BufferGeometry[] = []
      const lampParts: THREE.BufferGeometry[] = []
      const numPillars = Math.floor(DECK_LENGTH / PILLAR_SPACING)
      for (let i = 0; i <= numPillars; i++) {
        const offset = -DECK_LENGTH / 2 + i * PILLAR_SPACING
        const pillar = assets.pillarGeo.clone()
        if (pos.rotation !== 0) {
          pillar.rotateY(pos.rotation)
          pillar.translate(offset, DECK_Y / 2, pos.z)
        } else {
          pillar.translate(0, DECK_Y / 2, pos.z + offset)
        }
        pillarParts.push(pillar)

        // Lampu di atas barrier
        const lamp = assets.lampGeo.clone()
        if (pos.rotation !== 0) {
          lamp.translate(offset, DECK_Y + 0.2, pos.z - DECK_WIDTH / 2 + 0.2)
        } else {
          lamp.translate(-DECK_WIDTH / 2 + 0.2, DECK_Y + 0.2, pos.z + offset)
        }
        lampParts.push(lamp)
      }

      results.push({
        deck: deck,
        barrier: mergeGeometries([barrierL, barrierR], false)!,
        pillars: mergeGeometries(pillarParts, false)!,
        lamps: mergeGeometries(lampParts, false)!,
      })
    }

    return results
  }, [assets])

  return (
    <group>
      {geos.map((geo, i) => (
        <group key={i}>
          {/* Dek beton */}
          <mesh geometry={geo.deck} material={assets.concreteMat} castShadow receiveShadow />
          {/* Barrier */}
          <mesh geometry={geo.barrier} material={assets.barrierMat} />
          {/* Pilar */}
          <mesh geometry={geo.pillars} material={assets.pillarMat} castShadow />
          {/* Lampu */}
          <mesh geometry={geo.lamps} material={assets.lampMat} />
        </group>
      ))}
    </group>
  )
}

export default ElevatedHighway
