import { useRef, useMemo, useCallback, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { TxType } from '@/data/tx-classifier'
import { useGasStore } from '@/store/gas-store'
import { getBuildingPosition } from './layout'

const MAX_PARTICLES = 500

/**
 * L28 (bagian partikel): pada viewport sempit (< 768 px), spawn & update
 * dibatasi ke 200 slot pertama. Pool tetap MAX_PARTICLES — slot di atas
 * limit tidak pernah di-spawn/di-update dan tetap zero-scale.
 */
const MOBILE_MAX_PARTICLES = 200
const MOBILE_WIDTH_PX = 768

// L2 (GC): konstanta module-scope — nol alokasi Color pada jalur per frame.
const DEAD_COLOR = new THREE.Color(0, 0, 0)
const FALLBACK_COLOR = new THREE.Color('#ffffff')

const TX_PARTICLE_COLORS: Record<TxType, THREE.Color> = {
  [TxType.NATIVE_TRANSFER]:  new THREE.Color('#4FC3F7'),
  [TxType.ERC20_TRANSFER]:   new THREE.Color('#81C784'),
  [TxType.ERC20_APPROVE]:    new THREE.Color('#AED581'),
  [TxType.DEX_SWAP]:         new THREE.Color('#FFD54F'),
  [TxType.LIQUIDITY]:        new THREE.Color('#FF8A65'),
  [TxType.BRIDGE_DEPOSIT]:   new THREE.Color('#CE93D8'),
  [TxType.BRIDGE_WITHDRAW]:  new THREE.Color('#B39DDB'),
  [TxType.NFT_TRANSFER]:     new THREE.Color('#F48FB1'),
  [TxType.NFT_MINT]:         new THREE.Color('#EF5350'),
  [TxType.CONTRACT_DEPLOY]:  new THREE.Color('#90A4AE'),
  [TxType.CONTRACT_CALL]:    new THREE.Color('#78909C'),
  [TxType.RWA_TOKEN]:        new THREE.Color('#4DD0E1'),
}

interface Particle {
  position: THREE.Vector3
  velocity: THREE.Vector3
  color: THREE.Color
  life: number
  maxLife: number
  size: number
  active: boolean
}

export function GasParticles() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const particles = useRef<Particle[]>([])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  // F1: hash tx terbaru yang sudah di-spawn. Deteksi lama
  // (`recentTxs.length > prevTxCount`) mati permanen saat ring buffer penuh
  // (200) karena length berhenti bertambah.
  const lastSpawnedHashRef = useRef<string | null>(null)
  // F2 (GC): jumlah partikel aktif — 0 → seluruh loop update + upload
  // instanceMatrix di-skip (jalur idle: 0 alokasi, 0 GPU upload).
  const activeCountRef = useRef(0)

  // L28: baca ukuran viewport (re-render hanya saat resize).
  const size = useThree((s) => s.size)
  const activeSlots = size.width < MOBILE_WIDTH_PX ? MOBILE_MAX_PARTICLES : MAX_PARTICLES

  const recentTxs = useGasStore((s) => s.recentTxs)
  const gasMetrics = useGasStore((s) => s.gasMetrics)

  const spawnParticle = useCallback((txType: TxType, gasUsed: number, maxSlot: number) => {
    const buildingPos = getBuildingPosition(txType)
    const color = TX_PARTICLE_COLORS[txType] || FALLBACK_COLOR

    // Cari slot inactive di dalam batas slot aktif (tanpa alokasi array).
    let inactive: Particle | undefined
    for (let i = 0; i < maxSlot; i++) {
      const p = particles.current[i]
      if (p && !p.active) {
        inactive = p
        break
      }
    }
    if (!inactive) return

    const heightNorm = gasMetrics.get(txType)
      ? Math.min((gasMetrics.get(txType)?.avgGasUsed || 100_000) / 300_000, 1) * 7.5 + 0.5
      : 2

    inactive.position.set(
      buildingPos[0] + (Math.random() - 0.5) * 0.8,
      heightNorm + 0.5,
      buildingPos[2] + (Math.random() - 0.5) * 0.8
    )
    inactive.velocity.set(
      (Math.random() - 0.5) * 0.5,
      0.8 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.5
    )
    inactive.color.copy(color)
    inactive.maxLife = 3
    inactive.life = inactive.maxLife
    inactive.size = Math.min(gasUsed / 500_000, 1) * 0.3 + 0.1
    inactive.active = true
  }, [gasMetrics])

  // F2 (pendukung): InstancedMesh default-nya identity matrix — tanpa
  // inisialisasi ini, jalur idle (skip loop) akan meninggalkan bola unit
  // terlihat di origin sebelum spawn pertama.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < MAX_PARTICLES; i++) {
      dummy.position.set(0, -100, 0)
      dummy.scale.setScalar(0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [dummy])

  // L28: viewport menyempit → matikan & zero-scale partikel di luar limit
  // sekali saja (bukan tiap frame).
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    let touched = false
    for (let i = activeSlots; i < MAX_PARTICLES; i++) {
      const p = particles.current[i]
      if (p && p.active) {
        p.active = false
        dummy.position.set(0, -100, 0)
        dummy.scale.setScalar(0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        touched = true
      }
    }
    if (touched) mesh.instanceMatrix.needsUpdate = true
  }, [activeSlots, dummy])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    // ---- F1: spawn berbasis hash (tahan ring buffer penuh) ----
    // recentTxs newest-first: spawn semua tx lebih baru dari hash terakhir
    // yang di-spawn, lalu update ref. Edge:
    //  - recentTxs kosong      → ref dipertahankan (tidak direset).
    //  - wrap/replace tanpa tx baru (recentTxs[0].hash === ref) → tidak spawn.
    //  - ref sudah keluar dari buffer (>200 tx baru sejak frame lalu) →
    //    scan penuh, seluruh isi buffer dianggap baru → spawn semua.
    let spawned = false
    if (recentTxs.length > 0) {
      const lastHash = lastSpawnedHashRef.current
      if (recentTxs[0].hash !== lastHash) {
        for (const tx of recentTxs) {
          if (tx.hash === lastHash) break
          spawnParticle(tx.txType, Number(tx.gasUsed), activeSlots)
          spawned = true
        }
        lastSpawnedHashRef.current = recentTxs[0].hash
      }
    }

    // ---- F2: jalur idle — skip loop + upload matrix sepenuhnya ----
    if (activeCountRef.current === 0 && !spawned) return

    let activeCount = 0
    for (let i = 0; i < activeSlots; i++) {
      const p = particles.current[i]
      if (!p) continue

      if (p.active) {
        activeCount++
        p.life -= delta
        if (p.life <= 0) {
          p.active = false
          dummy.scale.setScalar(0)
        } else {
          p.position.x += p.velocity.x * delta
          p.position.y += p.velocity.y * delta
          p.position.z += p.velocity.z * delta
          p.velocity.y -= 0.1 * delta

          const lifeRatio = p.life / p.maxLife
          dummy.position.copy(p.position)
          dummy.scale.setScalar(p.size * lifeRatio)
        }
      } else {
        dummy.position.set(0, -100, 0)
        dummy.scale.setScalar(0)
      }

      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, p.active ? p.color : DEAD_COLOR)
    }
    activeCountRef.current = activeCount

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  useMemo(() => {
    particles.current = Array.from({ length: MAX_PARTICLES }, () => ({
      position: new THREE.Vector3(0, -100, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      color: new THREE.Color(0, 0, 0),
      life: 0,
      maxLife: 3,
      size: 0,
      active: false,
    }))
  }, [])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PARTICLES]}>
      <sphereGeometry args={[0.15, 8, 6]} />
      <meshBasicMaterial transparent opacity={0.85} toneMapped={false} />
    </instancedMesh>
  )
}
