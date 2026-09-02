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
    // L19 (kontrak dipertahankan): scrolling pakai uOffset terintegrasi di CPU
    // (useFrame), bukan uTime * uSpeed — perubahan kecepatan tidak menggeser
    // pola secara retroaktif. uTime tetap untuk evolusi noise.
    uv.x += uOffset;

    float n1 = snoise(uv * 3.0 + uTime * 0.05) * 0.5 + 0.5;
    float n2 = snoise(uv * 6.0 + 100.0 + uTime * 0.05) * 0.5 + 0.5;
    float noise = n1 * 0.7 + n2 * 0.3;

    float edgeFade = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);

    // Gelombang halus: displacement kecil di fragment lewat modulasi noise
    // (bukan vertex) — tetap murah.
    float wave = n1 * 0.05;

    // Kilau/spekular air: highlight pada noise bernilai tinggi + shimmer halus
    // (AC: solid, bukan neon — dibatasi uIntensity & di-clamp).
    float specular = smoothstep(0.55, 0.9, noise) * uIntensity * 0.4;
    float shimmer = sin(uv.x * 40.0 + uTime * 2.0) * 0.02;

    // Warna air dari gas price (r,g) — BUKAN full additive: dipakai sebagai
    // warna dasar + bias kebiruan agar terlihat seperti air.
    vec3 base = uColor * 0.55 + vec3(0.02, 0.05, 0.12);

    vec3 finalColor = min(base + vec3(specular + shimmer + wave), vec3(1.0));

    // Alpha ~0.85 → riverbed di bawahnya ikut terlihat (kesan "dalam").
    float alpha = 0.85 * edgeFade;

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

  // Kontrak useFrame dipertahankan: hanya update uniform uTime/uOffset/
  // uColor/uIntensity — TIDAK menyentuh store baru, tanpa alokasi per frame.
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
    <group>
      {/*
        SUNGAI 3 lapis (AC rekonstruksi): dasar riverbed gelap → tepian kiri/
        kanan → permukaan air transparan di atasnya. Semua geometry dibuat
        sekali; kontrak tambahan: sungai utama di z=2 (koridor antara baris
        bangunan z=0 dan z=4 — "sungai data mengalir di tengah kota").

        Geometri presisi (clearance ≥ 0.15):
        - radius efektif plinth max = (2.0/2) × 1.05(pulse) × 1.05(hover)
          × 1.05(plinth) = 1.1576 ≈ 1.158 → koridor bebas z ∈ [1.158, 2.842].
        - safety 0.15 → AIR z ∈ [1.31, 2.69], lebar 1.38 (clearance 0.152).
        - BANK tipis 0.22 mengapit: z ∈ [1.09, 1.31] & [2.69, 2.91].
        - RIVERBED sedikit lebih lebar dari air: z ∈ [1.10, 2.90] (lebar 1.8).
        - Y: riverbed 0.01 / air 0.06 / bank box 0–0.15 (center 0.075).
        Panjang plane tetap 36 (membentang x ∈ [-18, 18]).
      */}

      {/* Dasar sungai — gelap kebiruan, kasar; terlihat lewat air alpha 0.85 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 2]} receiveShadow>
        <planeGeometry args={[36, 1.8]} />
        <meshStandardMaterial color="#0d1b26" roughness={0.9} metalness={0.15} />
      </mesh>

      {/* Tepian (bank) kiri & kanan — warna tanah/kerikil, sungai terkurung.
          Tipis 0.22, tinggi 0.15 (0–0.15 dari lantai). */}
      <mesh position={[0, 0.075, 1.2]}>
        <boxGeometry args={[36, 0.15, 0.22]} />
        <meshStandardMaterial color="#3a3a3f" roughness={1} metalness={0} />
      </mesh>
      <mesh position={[0, 0.075, 2.8]}>
        <boxGeometry args={[36, 0.15, 0.22]} />
        <meshStandardMaterial color="#4a4a45" roughness={1} metalness={0} />
      </mesh>

      {/* Permukaan air — NormalBlending (bukan Additive) + alpha ~0.85,
          depthWrite false agar transparansi berlapis dengan riverbed. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 2]}>
        <planeGeometry args={[36, 1.38]} />
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
