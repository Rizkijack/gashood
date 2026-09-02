import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGasStore } from '@/store/gas-store'

const SKY_STATES = [
  { utilization: 0,    top: new THREE.Color('#1a3a5c'), bottom: new THREE.Color('#87CEEB') },
  { utilization: 0.05, top: new THREE.Color('#2a4a6c'), bottom: new THREE.Color('#87CEEB') },
  { utilization: 0.2,  top: new THREE.Color('#4a3a2c'), bottom: new THREE.Color('#E8A060') },
  { utilization: 0.5,  top: new THREE.Color('#3a1a1a'), bottom: new THREE.Color('#CC4422') },
  { utilization: 1.0,  top: new THREE.Color('#1a0a0a'), bottom: new THREE.Color('#881111') },
]

/**
 * L20 — Keputusan sumber utilization (dokumentasi keputusan):
 *
 * Utilization = avgBlockGas / BLOCK_GAS_LIMIT, clamp 0..1.
 *
 * Dipilih rasio blok (bukan TPS ternormalisasi) karena:
 * 1. `totalTransactions` bersifat kumulatif-monotonik — pemakaian lama
 *    (`totalTransactions / 5000`) membuat langit terkunci di PEAK selamanya
 *    setelah ~5000 tx; bug yang diperbaiki di sini.
 * 2. TPS dinilai kurang tepat setelah membaca store: `blockTime` Robinhood
 *    Chain = 100 ms (config/chain.ts), sehingga tps = jumlah tx per batch × 10
 *    dan normalisasi TPS butuh konstanta max-TPS karangan.
 * 3. `avgBlockGas` dari store adalah rata-rata gasUsed per tx pada batch poll
 *    terbaru (bukan total gas blok — total blok tidak tersedia di store), jadi
 *    rasio ini adalah proksi beban blok terkini: batch yang berat (avg gas
 *    tinggi, mis. banyak contract call) mendorong utilization naik, dan nilai
 *    reset setiap poll — selalu mencerminkan kondisi SEKARANG.
 *
 * Catatan rentang: dengan gas per tx tipikal (21k–500k), utilization berada di
 * ~0.06–1.5% (LOW). Preset threshold 5/20/50% tetap dipertahankan — langit
 * bergerak ke MEDIUM/HIGH hanya saat blok benar-benar berat, sesuai semantik
 * "rasio terhadap gas limit blok".
 */
const BLOCK_GAS_LIMIT = 32_500_000 // Arbitrum Nitro block gas limit

// L6 (GC): scratch Color pre-alloc — lerp per frame tanpa alokasi Color baru.
const scratchTop = new THREE.Color()
const scratchBottom = new THREE.Color()

/** Tulis hasil lerp preset ke out-param (tidak mengalokasikan Color baru). */
function getSkyColors(utilization: number, outTop: THREE.Color, outBottom: THREE.Color): void {
  for (let i = 0; i < SKY_STATES.length - 1; i++) {
    const curr = SKY_STATES[i]
    const next = SKY_STATES[i + 1]
    if (utilization >= curr.utilization && utilization <= next.utilization) {
      const t = (utilization - curr.utilization) / (next.utilization - curr.utilization)
      outTop.copy(curr.top).lerp(next.top, t)
      outBottom.copy(curr.bottom).lerp(next.bottom, t)
      return
    }
  }
  const last = SKY_STATES[SKY_STATES.length - 1]
  outTop.copy(last.top)
  outBottom.copy(last.bottom)
}

const vertexShader = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const fragmentShader = `
  uniform vec3 uTopColor;
  uniform vec3 uBottomColor;
  uniform float uOffset;
  uniform float uExponent;
  varying vec3 vWorldPosition;

  void main() {
    float h = normalize(vWorldPosition + uOffset).y;
    float t = max(pow(max(h, 0.0), uExponent), 0.0);
    gl_FragColor = vec4(mix(uBottomColor, uTopColor, t), 1.0);
  }
`

export function SkyDome() {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const currentTop = useRef(new THREE.Color('#1a3a5c'))
  const currentBottom = useRef(new THREE.Color('#87CEEB'))

  const networkStats = useGasStore((s) => s.networkStats)

  const uniforms = useMemo(
    () => ({
      uTopColor: { value: new THREE.Color('#1a3a5c') },
      uBottomColor: { value: new THREE.Color('#87CEEB') },
      uOffset: { value: 0.4 },
      uExponent: { value: 0.4 },
    }),
    []
  )

  useFrame(() => {
    if (!matRef.current) return

    // L20: utilization dari rasio blok terkini, clamp 0..1 (lihat komentar
    // BLOCK_GAS_LIMIT) — bukan totalTransactions yang kumulatif-monotonik.
    const utilization = Math.min(Math.max(networkStats.avgBlockGas / BLOCK_GAS_LIMIT, 0), 1)
    getSkyColors(utilization, scratchTop, scratchBottom)

    currentTop.current.lerp(scratchTop, 0.02)
    currentBottom.current.lerp(scratchBottom, 0.02)

    matRef.current.uniforms.uTopColor.value.copy(currentTop.current)
    matRef.current.uniforms.uBottomColor.value.copy(currentBottom.current)
  })

  return (
    <mesh>
      <sphereGeometry args={[50, 32, 16]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
      />
    </mesh>
  )
}
