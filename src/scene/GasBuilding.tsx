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

export function GasBuilding({ txType, position }: GasBuildingProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Subscribe to metrics for this txType
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

  // Emissive intensity dari recentTxCount: normalize 0..50 -> 0.1..0.8
  const emissiveIntensity = useMemo(() => {
    const normalized = Math.min(recentTxCount / 50, 1);
    return 0.1 + normalized * 0.7;
  }, [recentTxCount]);

  const isSelected = selectedType === txType;
  const isStoreHovered = hoveredType === txType;
  const activeHover = isHovered || isStoreHovered;

  // ---- L17 + L21: satu useFrame yang menggabungkan lerp & pulse ----
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const outlineRef = useRef<THREE.Mesh>(null);

  // L17: state animasi per bangunan (tanpa alokasi per frame)
  const currentHeightRef = useRef<number | null>(null); // null = snap frame pertama
  const currentColorRef = useRef(new THREE.Color(baseColor));
  const targetColorRef = useRef(new THREE.Color(baseColor));
  const lastBaseColorRef = useRef(baseColor);

  // L21: state pulse
  const pulseRef = useRef(0);
  const prevTxCountRef = useRef(0);

  useFrame(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    // (a) L17 — lerp tinggi (faktor 0.05) & posisi y = height/2 agar
    // bangunan tumbuh dari lantai.
    if (currentHeightRef.current === null) currentHeightRef.current = height;
    currentHeightRef.current = THREE.MathUtils.lerp(currentHeightRef.current, height, 0.05);
    const currentHeight = currentHeightRef.current;

    // (a) L17 — lerp warna (faktor 0.03), tanpa alokasi. Target hanya
    // di-parse saat baseColor berubah (re-render oleh store), bukan per frame.
    if (lastBaseColorRef.current !== baseColor) {
      targetColorRef.current.set(baseColor);
      lastBaseColorRef.current = baseColor;
    }
    currentColorRef.current.lerp(targetColorRef.current, 0.03);
    mat.color.copy(currentColorRef.current);
    mat.emissive.copy(currentColorRef.current);

    // (b) L21 — pulse: recentTxCount naik -> pulse = 1, decay x0.95/frame.
    if (recentTxCount > prevTxCountRef.current) pulseRef.current = 1;
    prevTxCountRef.current = recentTxCount;
    pulseRef.current *= 0.95;
    const pulse = pulseRef.current;

    // Hover/selected dipertahankan: boost 1.05 digabungkan ke skala
    // (setara displayScale lama [1.05, 1.05, 1.05] pada mesh berskala data).
    const hoverBoost = activeHover || isSelected ? 1.05 : 1;

    // L21: pulse ke scale.x/z — baseWidth x (1 + pulse x 0.05).
    mesh.scale.set(
      width * (1 + pulse * 0.05) * hoverBoost,
      currentHeight * hoverBoost,
      width * (1 + pulse * 0.05) * hoverBoost
    );
    mesh.position.y = currentHeight / 2;

    // L21: pulse ke emissiveIntensity (+pulse x 0.5), perilaku hover/selected
    // lama (x1.8) dipertahankan dan digabungkan, tidak saling menimpa.
    mat.emissiveIntensity =
      emissiveIntensity * (activeHover || isSelected ? 1.8 : 1) + pulse * 0.5;

    // Outline wireframe mengikuti skala bangunan yang dianimasikan
    // (setara skala lama [1.08, 1.02, 1.08] di atas ukuran data).
    const outline = outlineRef.current;
    if (outline) {
      outline.scale.set(width * 1.08, currentHeight * 1.02, width * 1.08);
      outline.position.y = currentHeight / 2;
    }
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
        F-4: SATU unit boxGeometry (1,1,1) statis — nol BufferGeometry dibuat
        ulang per poll. Ukuran data (width/height) lewat scale, dianimasikan
        useFrame di atas. position/scale JSX = nilai awal (target); useFrame
        mengambil alih setiap frame.
      */}
      <mesh
        ref={meshRef}
        position={[0, height / 2, 0]}
        scale={[width, height, width]}
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
          metalness={0.2}
          roughness={0.5}
          transparent={avgGasUsed === 0}
          opacity={avgGasUsed === 0 ? 0.6 : 1}
        />
      </mesh>

      {/* Selected outline effect via secondary wireframe box — unit geometry
          + scale (F-4), mengikuti animasi useFrame. */}
      {isSelected && (
        <mesh
          ref={outlineRef}
          position={[0, height / 2, 0]}
          scale={[width * 1.08, height * 1.02, width * 1.08]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={baseColor} wireframe transparent opacity={0.35} />
        </mesh>
      )}

      {/* Floating label — wrapped in <Billboard> so the text always faces
          the camera (drei <Text> alone does NOT auto-billboard) */}
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
