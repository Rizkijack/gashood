import { Billboard, Text } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TxType } from "@/data/tx-classifier";
import { useGasStore } from "@/store/gas-store";

interface GasBuildingProps {
  txType: TxType;
  position: [number, number, number];
}

// Tinggi tetap (world units) plinth & atap — tidak ikut scale tinggi bangunan.
const PLINTH_HEIGHT = 0.12;
const ROOF_HEIGHT = 0.15;

/** Color scale per 3D_DESIGN.md gas price bracket (Gwei) */
function getColorForGasPrice(avgGasPrice: number): string {
  if (avgGasPrice === 0) return "#333344";
  if (avgGasPrice < 0.01) return "#00FF88";
  if (avgGasPrice < 0.05) return "#44CC66";
  if (avgGasPrice < 0.1) return "#88BB44";
  if (avgGasPrice < 0.5) return "#CCAA22";
  if (avgGasPrice < 1.0) return "#FF7722";
  return "#FF2244";
}

function formatLabel(txType: string): string {
  return txType.replace(/_/g, " ").toUpperCase();
}

/* ---- Jendela procedural (CanvasTexture) -----------------------------------
 * Satu tekstur "grid jendela" per baseColor, di-cache agar tidak dibuat ulang
 * saat re-render. Dipakai sebagai map + emissiveMap material body — ZERO extra
 * draw call (AC rekonstruksi visual). Jendela menyala lewat emissiveIntensity
 * yang sudah ada (emissiveMap × emissive color × intensity). */
const windowTextureCache = new Map<string, THREE.CanvasTexture>();

function getWindowTexture(baseColor: string): THREE.CanvasTexture {
  const cached = windowTextureCache.get(baseColor);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia");

  // Dinding gelap — warna asli bangunan tetap terlihat lewat color material.
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, 128, 256);

  const cols = 6;
  const rows = 14;
  const marginX = 6;
  const marginY = 5;
  const cellW = (128 - marginX * 2) / cols;
  const cellH = (256 - marginY * 2) / rows;

  // PRNG kecil & deterministik untuk variasi jendela (mati/terang) — hasil
  // konsisten untuk baseColor yang sama (cache), bukan random per render.
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.12) continue; // sebagian jendela mati — lebih realistis
      const glow = 0.75 + rnd() * 0.25;
      const x = marginX + c * cellW + 1.5;
      const y = marginY + r * cellH + 1.5;
      const w = cellW - 3;
      const h = cellH - 3;
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, `rgba(255,255,255,${glow})`);
      grad.addColorStop(1, `rgba(170,185,255,${glow * 0.65})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  windowTextureCache.set(baseColor, tex);
  return tex;
}

export function GasBuilding({ txType, position }: GasBuildingProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Subscribe ke metrics store untuk txType ini (kontrak dipertahankan).
  const metric = useGasStore((s) => s.gasMetrics.get(txType));
  const hoveredType = useGasStore((s) => s.hoveredType);
  const selectedType = useGasStore((s) => s.selectedType);

  const avgGasUsed = metric?.avgGasUsed ?? 0;
  const avgGasPrice = metric?.avgGasPrice ?? 0;
  const recentTxCount = metric?.recentTxCount ?? 0;

  // Height mapping (WORKFLOW.md 2.4): normalize(avgGasUsed, 0, 200_000) * 7.5 + 0.5, clamp agar <= 8
  const height = useMemo(() => {
    if (avgGasUsed === 0) return 0.5;
    return Math.min(avgGasUsed / 200_000, 1) * 7.5 + 0.5;
  }, [avgGasUsed]);

  // Width mapping (BUILD_STEPS.md Langkah 12): normalize(recentTxCount, 0, 50) * 1.5 + 0.5, clamp agar <= 2
  const width = useMemo(() => {
    return Math.min(recentTxCount / 50, 1) * 1.5 + 0.5;
  }, [recentTxCount]);

  const baseColor = useMemo(() => getColorForGasPrice(avgGasPrice), [avgGasPrice]);

  // Tekstur jendela — dibuat sekali lalu di-cache per baseColor (bukan per frame).
  const windowTexture = useMemo(() => getWindowTexture(baseColor), [baseColor]);

  // Warna turunan plinth & atap: baseColor digelapkan ~28-30% — hitung sekali
  // saat baseColor berubah via useMemo, BUKAN per frame (AC).
  const plinthColor = useMemo(() => new THREE.Color(baseColor).multiplyScalar(0.7), [baseColor]);
  const roofColor = useMemo(() => new THREE.Color(baseColor).multiplyScalar(0.72), [baseColor]);

  // Emissive intensity dari recentTxCount: normalize 0..50 -> 0.1..0.8
  const emissiveIntensity = useMemo(() => {
    const normalized = Math.min(recentTxCount / 50, 1);
    return 0.1 + normalized * 0.7;
  }, [recentTxCount]);

  const isSelected = selectedType === txType;
  const isStoreHovered = hoveredType === txType;
  const activeHover = isHovered || isStoreHovered;
  const hoverBoost = activeHover || isSelected ? 1.05 : 1;

  // ---- L17 + L21: satu useFrame yang menggabungkan lerp & pulse ----
  // GROUP = body + plinth + roof (AC: lerp diterapkan ke group, bukan mesh
  // tunggal). Geometry SATU KALI (unit 1×1×1) — ukuran data lewat scale.
  const groupRef = useRef<THREE.Group>(null);
  const plinthRef = useRef<THREE.Mesh>(null);
  const roofRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  // State animasi per bangunan (tanpa alokasi per frame)
  const currentHeightRef = useRef<number | null>(null); // null = snap frame pertama
  const currentColorRef = useRef(new THREE.Color(baseColor));
  const targetColorRef = useRef(new THREE.Color(baseColor));
  const lastBaseColorRef = useRef(baseColor);

  // State pulse
  const pulseRef = useRef(0);
  const prevTxCountRef = useRef(0);

  useFrame(() => {
    const group = groupRef.current;
    const mat = matRef.current;
    if (!group || !mat) return;

    // (a) L17 — lerp tinggi (faktor 0.05); posisi y = height/2 agar bangunan
    // tumbuh dari lantai (group origin = dasar bangunan; body unit di [0,0,0]
    // → world span [0, height]). Lerp ke GROUP scale [width, height, width].
    if (currentHeightRef.current === null) currentHeightRef.current = height;
    currentHeightRef.current = THREE.MathUtils.lerp(currentHeightRef.current, height, 0.05);
    const currentHeight = currentHeightRef.current;

    // (a) L17 — lerp warna (faktor 0.03), tanpa alokasi. Target hanya di-parse
    // saat baseColor berubah (re-render oleh store), bukan per frame.
    if (lastBaseColorRef.current !== baseColor) {
      targetColorRef.current.set(baseColor);
      lastBaseColorRef.current = baseColor;
    }
    currentColorRef.current.lerp(targetColorRef.current, 0.03);
    mat.color.copy(currentColorRef.current);
    mat.emissive.copy(currentColorRef.current); // glow lewat emissiveMap jendela

    // (b) L21 — pulse: recentTxCount naik -> pulse = 1, decay x0.95/frame.
    if (recentTxCount > prevTxCountRef.current) pulseRef.current = 1;
    prevTxCountRef.current = recentTxCount;
    pulseRef.current *= 0.95;
    const pulse = pulseRef.current;

    // Hover/selected dipertahankan: boost 1.05 digabungkan ke skala group.
    const hoverBoostLocal = activeHover || isSelected ? 1.05 : 1;
    const sclX = width * (1 + pulse * 0.05) * hoverBoostLocal;
    const sclY = currentHeight * hoverBoostLocal;
    group.scale.set(sclX, sclY, sclX);
    group.position.y = currentHeight / 2;

    // Plinth & atap tetap tipis di dunia (0.12/0.15) — counter-scale sumbu Y
    // terhadap group yang sudah diskalakan tinggi bangunan (lebar x/z otomatis
    // mengikuti group: 1.05× untuk plinth & atap — radius efektif plinth max
    // 1.158, lihat DataRiver untuk clearance sungai).
    const plinth = plinthRef.current;
    if (plinth) {
      plinth.scale.set(1.05, PLINTH_HEIGHT / sclY, 1.05);
      plinth.position.y = (PLINTH_HEIGHT / 2 - currentHeight / 2) / sclY;
    }
    const roof = roofRef.current;
    if (roof) {
      roof.scale.set(1.05, ROOF_HEIGHT / sclY, 1.05);
      roof.position.y = (currentHeight / 2 + ROOF_HEIGHT / 2) / sclY;
    }

    // L21: pulse ke emissiveIntensity (+pulse x 0.5), perilaku hover/selected
    // lama (x1.8) dipertahankan dan digabungkan, tidak saling menimpa.
    mat.emissiveIntensity =
      emissiveIntensity * (activeHover || isSelected ? 1.8 : 1) + pulse * 0.5;
  });

  const handlePointerOver = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setIsHovered(true);
    useGasStore.getState().hoverType(txType);
    document.body.style.cursor = "pointer";
  };

  const handlePointerOut = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setIsHovered(false);
    // Only clear if we are still the hovered type
    if (useGasStore.getState().hoveredType === txType) {
      useGasStore.getState().hoverType(null);
    }
    document.body.style.cursor = "auto";
  };

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    const currentSelected = useGasStore.getState().selectedType;
    useGasStore.getState().selectType(currentSelected === txType ? null : txType);
  };

  const labelText = formatLabel(txType);

  return (
    <group position={position}>
      {/*
        ARSITEKTUR baru (AC rekonstruksi): body utama + plinth/fondasi + atap/
        parapet dalam SATU group animasi.
        - Geometry SATU KALI (unit) — ukuran data lewat transform group.
        - useFrame me-lerp scale/posisi group; mesh anak statis.
        - Group origin = DASAR bangunan (body unit di posisi [0,0,0] → base
          menempel lantai, bukan melayang di h/2).
        - Outline = child group → otomatis mengikuti lerp/pulse/hover (1.08×).
      */}
      <group
        ref={groupRef}
        position={[0, height / 2, 0]}
        scale={[width, height, width]}
      >
        {/* Body utama — jendela CanvasTexture (map + emissiveMap, 1 material).
            Unit box ±0.5 di origin group → world span [0, height]. */}
        <mesh
          position={[0, 0, 0]}
          castShadow
          receiveShadow
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <boxGeometry args={[1, 1, 1]} />
          {/* color/emissive/emissiveIntensity dimiliki useFrame (lerp + pulse) */}
          <meshStandardMaterial
            ref={matRef}
            map={windowTexture}
            emissiveMap={windowTexture}
            metalness={0.35}
            roughness={0.4}
            transparent={avgGasUsed === 0}
            opacity={avgGasUsed === 0 ? 0.6 : 1}
          />
        </mesh>

        {/* Plinth/fondasi: 1.05× lebar body (radius efektif max 1.158 — lihat
            DataRiver untuk clearance sungai), tipis 0.12 — ikut memudar saat
            avgGasUsed === 0 (transparent di material masing-masing).
            Handler pointer sama dengan body → tidak ada dead-zone hover/click. */}
        <mesh
          ref={plinthRef}
          position={[0, (PLINTH_HEIGHT / 2 - height / 2) / (height * hoverBoost), 0]}
          scale={[1.05, PLINTH_HEIGHT / (height * hoverBoost), 1.05]}
          receiveShadow
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={plinthColor}
            roughness={0.6}
            metalness={0.2}
            transparent={avgGasUsed === 0}
            opacity={avgGasUsed === 0 ? 0.6 : 1}
          />
        </mesh>

        {/* Atap/parapet: scale x/z lokal 1.05 → lebar atap = width × 1.05
            OTOMATIS mengikuti width aktual bangunan (termasuk pulse/hover —
            karena di dalam group berskala). Tipis 0.15, metalness tinggi,
            warna senada lebih gelap (dihitung sekali, bukan per frame).
            Handler pointer sama dengan body → tidak ada dead-zone hover/click. */}
        <mesh
          ref={roofRef}
          position={[0, (height / 2 + ROOF_HEIGHT / 2) / (height * hoverBoost), 0]}
          scale={[1.05, ROOF_HEIGHT / (height * hoverBoost), 1.05]}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={roofColor}
            metalness={0.7}
            roughness={0.3}
            transparent={avgGasUsed === 0}
            opacity={avgGasUsed === 0 ? 0.6 : 1}
          />
        </mesh>

        {/* Selected outline via wireframe box — child group: skala lokal statis
            1.08× group (AC), mengikuti animasi group tanpa update per frame.
            Posisi origin group (dasar bangunan) + scale y 1.02 → membungkus
            body [0, height] tanpa melayang. */}
        {isSelected && (
          <mesh position={[0, 0, 0]} scale={[1.08, 1.02, 1.08]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={baseColor} wireframe transparent opacity={0.35} />
          </mesh>
        )}
      </group>

      {/* Floating label — wrapped in <Billboard> agar selalu menghadap kamera
          (drei <Text> tidak auto-billboard). Di luar group animasi → tidak ikut
          scale bangunan (perilaku lama dipertahankan). */}
      <Billboard position={[0, height + 0.7, 0]}>
        <Text
          fontSize={0.3}
          color="#fff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
          maxWidth={2}
          textAlign="center"
        >
          {labelText}
        </Text>
      </Billboard>

      {/* Secondary small label for gas price when active */}
      {avgGasPrice > 0 && (
        <Billboard position={[0, height + 0.35, 0]}>
          <Text
            fontSize={0.14}
            color={baseColor}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.01}
            outlineColor="#000000"
          >
            {avgGasPrice < 0.01 ? "<0.01 Gwei" : `${avgGasPrice.toFixed(3)} Gwei`}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

export default GasBuilding;
