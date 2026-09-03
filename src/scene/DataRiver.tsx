import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGasStore } from '@/store/gas-store'
import { CITY_SCALE, RIVER_Z } from './layout'
import { DEFAULT_CAMERA } from './CameraFocus'

function safe(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform float uOffset;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform vec3 uCameraPos;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  // ── Noise functions ──────────────────────────────────────────────
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

  // FBM (fractal brownian motion) — 4 octaves untuk detail air
  float fbm(vec2 p) {
    float f = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      f += amp * snoise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return f;
  }

  void main() {
    vec2 uv = vUv;

    // ── 1. Current flow — lambat, organik ──────────────────────────
    // Base flow: arus utama ke kanan (dx)
    float flowX = uOffset * 0.12;

    // Lateral drift: arus menyamping halus (dy sinusoidal)
    float driftY = sin(uv.x * 2.5 + uTime * 0.15) * 0.03;

    // Vortex kecil: area eddy statis di beberapa titik
    float vortex1 = sin(uv.x * 4.0 + 1.3) * cos(uv.y * 3.0 + 0.7) * 0.02;
    float vortex2 = cos(uv.x * 6.0 + 2.1) * sin(uv.y * 5.0 + 1.9) * 0.015;

    vec2 flowUV = uv + vec2(flowX, driftY + vortex1 + vortex2);

    // ── 2. Multi-layer noise untuk permukaan air ──────────────────
    // Layer 1: gelombang besar (arus utama)
    float wave1 = fbm(flowUV * 2.0 + uTime * 0.02) * 0.5 + 0.5;

    // Layer 2: riak kecil (detail permukaan)
    float ripple = snoise(flowUV * 8.0 + uTime * 0.08) * 0.5 + 0.5;

    // Layer 3: kilau kasatmata (specular highlight)
    float sparkle = snoise(flowUV * 16.0 + uTime * 0.3) * 0.5 + 0.5;

    // Gabungkan: wave dominan, ripple sebagai detail, sparkle sebagai highlight
    float surface = wave1 * 0.6 + ripple * 0.25 + sparkle * 0.15;

    // ── 3. Edge effect — air lebih gelap di tepi (depth cue) ──────
    float edgeDist = min(vUv.y, 1.0 - vUv.y);
    float edgeDarken = smoothstep(0.0, 0.2, edgeDist);
    float edgeHighlight = smoothstep(0.0, 0.08, edgeDist);

    // ── 4. Warna air realistis ────────────────────────────────────
    // Base: deep water blue-green
    vec3 deepWater = vec3(0.02, 0.06, 0.12);
    vec3 shallowWater = vec3(0.04, 0.12, 0.18);
    vec3 surfaceHighlight = vec3(0.15, 0.25, 0.30);

    // Mix berdasarkan depth (edge = deep, center = shallow)
    vec3 waterBase = mix(deepWater, shallowWater, edgeDarken);

    // Tambah warna dari gas price (subtle tint)
    vec3 gasTint = uColor * 0.15;
    waterBase += gasTint;

    // ── 5. Specular & caustics ────────────────────────────────────
    // Specular: highlight pada area surface yang tinggi
    float specular = smoothstep(0.6, 0.85, surface) * uIntensity * 0.5;

    // Caustics: pola cahaya yang terpantul di dasar
    float caustics = smoothstep(0.55, 0.75, ripple) * 0.15 * edgeDarken;

    // Shimmer: kilau halus bergerak cepat
    float shimmer = sin(flowUV.x * 30.0 + uTime * 1.5) * 0.015;
    shimmer *= smoothstep(0.3, 0.7, vUv.y); // hanya di tengah

    // ── 6. Fresnel-like rim light ─────────────────────────────────
    float fresnel = pow(1.0 - max(dot(vNormal, normalize(uCameraPos - vWorldPos)), 0.0), 3.0);
    fresnel = clamp(fresnel, 0.0, 0.4) * edgeHighlight;

    // ── 7. Final compositing ──────────────────────────────────────
    vec3 finalColor = waterBase;
    finalColor += vec3(specular + caustics + shimmer + fresnel);

    // Desaturasi sedikit agar tidak terlalu saturated
    float luma = dot(finalColor, vec3(0.299, 0.587, 0.114));
    finalColor = mix(vec3(luma), finalColor, 0.85);

    // Clamp agar tidak blow out
    finalColor = min(finalColor, vec3(0.45));

    // Alpha: lebih transparan di tengah, lebih opaque di tepi
    float alpha = mix(0.7, 0.92, edgeDarken) * uIntensity * 0.9 + 0.1;

    gl_FragColor = vec4(finalColor, alpha);
  }
`

export function DataRiver() {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const networkStats = useGasStore((s) => s.networkStats)
  const cameraRef = useRef(new THREE.Vector3(...DEFAULT_CAMERA))

  const offsetRef = useRef(0)

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
      uCameraPos: { value: new THREE.Vector3(...DEFAULT_CAMERA) },
    }),
    []
  )

  useFrame((state, delta) => {
    if (!matRef.current) return

    const tps = safe(networkStats.tps, 0)
    const avgGasPrice = safe(networkStats.currentGasPrice, 0)
    const total = safe(totalTxs, 0)

    // Kecepatan arus: LAMBAT — base 0.3, max ~1.5 pada TPS tinggi
    // Sebelumnya: Math.min(tps / 10, 3) + 0.5 → bisa 3.5
    // Sekarang: Math.min(tps / 30, 1.0) + 0.3 → max 1.3
    const speed = safe(Math.min(tps / 30, 1.0) + 0.3, 0.3) * CITY_SCALE
    offsetRef.current += speed * delta

    // Update camera position untuk fresnel
    cameraRef.current.copy(state.camera.position)

    matRef.current.uniforms.uTime.value = safe(state.clock.elapsedTime, 0)
    matRef.current.uniforms.uOffset.value = safe(offsetRef.current, 0)
    matRef.current.uniforms.uCameraPos.value.copy(cameraRef.current)

    // Warna air: lebih kebiruan, gas price sebagai subtle tint
    const r = Math.min(avgGasPrice / 0.5, 1) * 0.15 + 0.02
    const g = Math.min(avgGasPrice / 0.5, 1) * 0.08 + 0.08
    const b = 0.15 + Math.min(avgGasPrice / 0.5, 1) * 0.05
    matRef.current.uniforms.uColor.value.setRGB(r, g, b)

    matRef.current.uniforms.uIntensity.value = Math.min(total / 100, 1) * 0.6 + 0.4
  })

  return (
    <group>
      {/* Dasar sungai — gelap kebiruan */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01 * CITY_SCALE, RIVER_Z]} receiveShadow>
        <planeGeometry args={[36 * CITY_SCALE, 1.8 * CITY_SCALE]} />
        <meshStandardMaterial color="#0a1520" roughness={0.95} metalness={0.1} />
      </mesh>

      {/* Tepian (bank) kiri & kanan — batu/kerikil */}
      <mesh position={[0, 0.075 * CITY_SCALE, RIVER_Z - 0.8 * CITY_SCALE]}>
        <boxGeometry args={[36 * CITY_SCALE, 0.15 * CITY_SCALE, 0.22 * CITY_SCALE]} />
        <meshStandardMaterial color="#2a2a2f" roughness={1} metalness={0} />
      </mesh>
      <mesh position={[0, 0.075 * CITY_SCALE, RIVER_Z + 0.8 * CITY_SCALE]}>
        <boxGeometry args={[36 * CITY_SCALE, 0.15 * CITY_SCALE, 0.22 * CITY_SCALE]} />
        <meshStandardMaterial color="#3a3a38" roughness={1} metalness={0} />
      </mesh>

      {/* Permukaan air — shader realistis */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06 * CITY_SCALE, RIVER_Z]}>
        <planeGeometry args={[36 * CITY_SCALE, 1.38 * CITY_SCALE, 64, 16]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
      </mesh>
    </group>
  )
}
