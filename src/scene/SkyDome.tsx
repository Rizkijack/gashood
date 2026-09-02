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

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return new THREE.Color().copy(a).lerp(b, t)
}

function getSkyColors(utilization: number): { top: THREE.Color; bottom: THREE.Color } {
  for (let i = 0; i < SKY_STATES.length - 1; i++) {
    const curr = SKY_STATES[i]
    const next = SKY_STATES[i + 1]
    if (utilization >= curr.utilization && utilization <= next.utilization) {
      const t = (utilization - curr.utilization) / (next.utilization - curr.utilization)
      return {
        top: lerpColor(curr.top, next.top, t),
        bottom: lerpColor(curr.bottom, next.bottom, t),
      }
    }
  }
  const last = SKY_STATES[SKY_STATES.length - 1]
  return { top: last.top.clone(), bottom: last.bottom.clone() }
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

    const utilization = Math.min(networkStats.totalTransactions / 5000, 1)
    const { top, bottom } = getSkyColors(utilization)

    currentTop.current.lerp(top, 0.02)
    currentBottom.current.lerp(bottom, 0.02)

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
