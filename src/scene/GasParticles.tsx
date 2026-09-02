import { useRef, useMemo, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { TxType } from '@/data/tx-classifier'
import { useGasStore } from '@/store/gas-store'
import { getBuildingPosition } from './layout'

const MAX_PARTICLES = 500

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
  const prevTxCount = useRef(0)

  const recentTxs = useGasStore((s) => s.recentTxs)
  const gasMetrics = useGasStore((s) => s.gasMetrics)

  const spawnParticle = useCallback((txType: TxType, gasUsed: number) => {
    const buildingPos = getBuildingPosition(txType)
    const color = TX_PARTICLE_COLORS[txType] || new THREE.Color('#ffffff')

    const inactive = particles.current.find((p) => !p.active)
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

  useFrame((_, delta) => {
    if (!meshRef.current) return

    if (recentTxs.length > prevTxCount.current) {
      const newTxs = recentTxs.slice(0, recentTxs.length - prevTxCount.current)
      for (const tx of newTxs) {
        spawnParticle(tx.txType, Number(tx.gasUsed))
      }
    }
    prevTxCount.current = recentTxs.length

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles.current[i]
      if (!p) continue

      if (p.active) {
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
      meshRef.current.setMatrixAt(i, dummy.matrix)
      meshRef.current.setColorAt(i, p.active ? p.color : new THREE.Color(0, 0, 0))
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
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
