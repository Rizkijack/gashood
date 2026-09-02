import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGasStore } from '@/store/gas-store'

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform float uSpeed;
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
    uv.x += uTime * uSpeed * 0.3;

    float n1 = snoise(uv * 3.0) * 0.5 + 0.5;
    float n2 = snoise(uv * 6.0 + 100.0) * 0.5 + 0.5;
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
  const gasMetrics = useGasStore((s) => s.gasMetrics)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSpeed: { value: 1.0 },
      uColor: { value: new THREE.Color('#44CC66') },
      uIntensity: { value: 0.5 },
    }),
    []
  )

  useFrame((state) => {
    if (!matRef.current) return

    const tps = networkStats.tps
    const avgGasPrice = networkStats.currentGasPrice

    matRef.current.uniforms.uTime.value = state.clock.elapsedTime
    matRef.current.uniforms.uSpeed.value = Math.min(tps / 10, 3) + 0.5

    const r = Math.min(avgGasPrice / 0.5, 1)
    const g = 1 - Math.min(avgGasPrice / 0.5, 1) * 0.5
    const b = 0.3
    matRef.current.uniforms.uColor.value.setRGB(r * 0.8 + 0.2, g * 0.8 + 0.1, b)

    const totalTxs = Array.from(gasMetrics.values()).reduce((s, m) => s + m.recentTxCount, 0)
    matRef.current.uniforms.uIntensity.value = Math.min(totalTxs / 100, 1) * 0.8 + 0.2
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
