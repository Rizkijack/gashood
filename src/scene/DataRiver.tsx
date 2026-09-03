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
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    // Displacement gelombang KECIL (total ±0.04 unit) — riak permukaan halus;
    // aman: tidak menyentuh riverbed (y=0.15) maupun bank (tepi plane z=±10.35
    // tepat memotong inner bank, displacement hanya vertikal).
    worldPos.y += sin(worldPos.x * 0.08 + uTime * 0.7) * 0.022
                + cos(worldPos.z * 0.12 + uTime * 0.5) * 0.016;
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const fragmentShader = `
  uniform float uTime;
  uniform float uOffset;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform vec3 uCameraPos;
  uniform vec3 uSkyColor;
  varying vec2 vUv;
  varying vec3 vWorldPos;

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

    // ── 1. Current flow — lambat, organik (dipertahankan) ──────────
    float flowX = uOffset * 0.12;
    float driftY = sin(uv.x * 2.5 + uTime * 0.15) * 0.03;
    float vortex1 = sin(uv.x * 4.0 + 1.3) * cos(uv.y * 3.0 + 0.7) * 0.02;
    float vortex2 = cos(uv.x * 6.0 + 2.1) * sin(uv.y * 5.0 + 1.9) * 0.015;
    vec2 flowUV = uv + vec2(flowX, driftY + vortex1 + vortex2);

    // ── 2. Layer noise permukaan (dipertahankan) ──────────────────
    float wave1 = fbm(flowUV * 2.0 + uTime * 0.02) * 0.5 + 0.5;
    float ripple = snoise(flowUV * 8.0 + uTime * 0.08) * 0.5 + 0.5;

    // ── 3. Mask kedalaman & tepi (vUv.y; sungai membentang sepanjang uv.x) ──
    float edgeDist = min(vUv.y, 1.0 - vUv.y);
    float centerMask = 1.0 - smoothstep(0.0, 0.28, edgeDist); // 1 = pusat
    float bankBand = 1.0 - smoothstep(0.0, 0.06, edgeDist);   // 1 = sisip bank

    // ── 4. Depth fake — pusat sungai LEBIH GELAP/dalam vs tepi ────
    vec3 deepWater = vec3(0.015, 0.045, 0.10);
    vec3 shallowWater = vec3(0.05, 0.11, 0.16);
    vec3 waterBase = mix(shallowWater, deepWater, centerMask);
    waterBase *= 0.85 + wave1 * 0.3; // modulasi arus besar
    waterBase += uColor * 0.12;      // tint gas price (subtle, dipertahankan)

    // ── 5. Fresnel sky reflection (Ethereal Glass) ─────────────────
    // View-dir terhadap UP: sudut landai (horizon) → dominan pantulan langit.
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
    fresnel = clamp(fresnel, 0.0, 1.0) * 0.65; // restrained — bukan cermin
    vec3 skyRefl = uSkyColor * (0.85 + ripple * 0.3);

    // ── 6. Sun glint memanjang searah aliran (anisotropic-ish) ────
    // Stretch uv.x (frekuensi rendah sepanjang arus) + smoothstep tinggi
    // → hanya puncak kilau yang tampak.
    float glint = snoise(vec2(flowUV.x * 3.0 + uTime * 0.12, flowUV.y * 26.0)) * 0.5 + 0.5;
    glint = smoothstep(0.78, 0.96, glint) * uIntensity;

    // ── 7. Foam tepi — band tipis animasi di dekat bank, restrained ──
    float foamNoise = snoise(vec2(uv.x * 42.0 - flowX * 1.5, uv.y * 6.0) + uTime * 0.1) * 0.5 + 0.5;
    float foamPulse = 0.5 + 0.5 * sin(uv.x * 9.0 - uTime * 0.4 + foamNoise * 3.0);
    float foam = bankBand * smoothstep(0.45, 0.85, foamNoise * 0.7 + foamPulse * 0.3) * 0.35;

    // ── 8. Caustics dasar (dipertahankan, diredam) ────────────────
    float caustics = smoothstep(0.55, 0.75, ripple) * 0.08 * (1.0 - centerMask);

    // ── 9. Final compositing ──────────────────────────────────────
    vec3 finalColor = mix(waterBase, skyRefl, fresnel);
    finalColor += vec3(0.10, 0.13, 0.15) * glint;       // glint kebiruan redam
    finalColor += vec3(0.72, 0.82, 0.88) * foam;        // foam putih-kebiruan kecil
    finalColor += vec3(caustics * 0.5);

    // Desaturasi sedikit + clamp (dipertahankan dari shader lama).
    float luma = dot(finalColor, vec3(0.299, 0.587, 0.114));
    finalColor = mix(vec3(luma), finalColor, 0.85);
    finalColor = min(finalColor, vec3(0.45));

    // Alpha ~0.85-0.9: pusat sedikit lebih opaque (kolom air lebih dalam).
    float alpha = mix(0.85, 0.9, centerMask);

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
      // BARU (Ethereal Glass): warna pantulan langit untuk fresnel — diambil
      // dari palet World/SkyDome (fog #0a0a0f, sky dome clear top #1a3a5c):
      // di antara keduanya agar pantulan restrained, bukan cermin terang.
      uSkyColor: { value: new THREE.Color('#1c2b3a') },
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
