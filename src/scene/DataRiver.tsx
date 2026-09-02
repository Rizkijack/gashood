import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGasStore } from '@/store/gas-store'

/** L10 (security/robustness): nilai uniform harus finite — data upstream
 * (RPC/store) bisa berupa NaN/Infinity dan meracuni shader. */
function safe(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform float uOffset;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;

  // Simplex-like noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
      + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m;
    m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = vUv;
    // L19: scrolling memakai uOffset yang terintegrasi di CPU (useFrame),
    // bukan uTime * uSpeed — perubahan kecepatan tidak lagi menggeser
    // pola secara retroaktif (phase-jump). uTime tetap dipakai untuk
    // evolusi noise, bukan scrolling.
    uv.x += uOffset;

    float n1 = snoise(uv * 3.0 + uTime * 0.05) * 0.5 + 0.5;
    float n2 = snoise(uv * 6.0 + 100.0 + uTime * 0.05) * 0.5 + 0.5;
    float noise = n1 * 0.7 + n2 * 0.3;

    float glow = smoothstep(0.2, 0.8, noise) * uIntensity;

    float edgeFade = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);

    vec3 finalColor = uColor * (glow + 0.1);
    float alpha = glow * edgeFade * 0.7;

    gl_FragColor = vec4(finalColor, alpha);
  }
`

export function DataRiver() {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const networkStats = useGasStore((s) => s.networkStats)

  // L19: offset diintegrasikan di CPU — kecepatan berubah TIDAK melompatkan
  // pola karena offset terakumulasi secara kontinu (delta dari clock).
  const offsetRef = useRef(0)

  // L8 (GC): totalTxs dihitung di selector zustand — hanya recompute saat
  // state store berubah (~tiap polling), BUKAN tiap frame, dan tanpa
  // alokasi `Array.from(gasMetrics.values())` per frame.
  const totalTxs = useGasStore((s) => {
    let sum = 0
    for (const m of s.gasMetrics.values()) sum += m.recentTxCount
    return sum
  })

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOffset: { value: 0 },
      uColor: { value: new THREE.Color('#44CC66') },
      uIntensity: { value: 0.5 },
    }),
    []
  )

  useFrame((state, delta) => {
    if (!matRef.current) return

    const tps = safe(networkStats.tps, 0)
    const avgGasPrice = safe(networkStats.currentGasPrice, 0)
    const total = safe(totalTxs, 0)

    // L19: integrasi offset di CPU (delta dari clock frame ini).
    const speed = safe(Math.min(tps / 10, 3) + 0.5, 0.5)
    offsetRef.current += speed * delta

    matRef.current.uniforms.uTime.value = safe(state.clock.elapsedTime, 0)
    matRef.current.uniforms.uOffset.value = safe(offsetRef.current, 0)

    const r = Math.min(avgGasPrice / 0.5, 1)
    const g = 1 - Math.min(avgGasPrice / 0.5, 1) * 0.5
    matRef.current.uniforms.uColor.value.setRGB(r * 0.8 + 0.2, g * 0.8 + 0.1, 0.3)

    matRef.current.uniforms.uIntensity.value = Math.min(total / 100, 1) * 0.8 + 0.2
  })

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
      <planeGeometry args={[36, 2.5]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
