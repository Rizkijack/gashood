import { Billboard, Text } from "@react-three/drei";
import { useMemo, useState } from "react";
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

  const displayScale: [number, number, number] =
    isSelected || activeHover ? [1.05, 1.05, 1.05] : [1, 1, 1];

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
      {/* Building mesh, anchored at ground: y = height/2 */}
      <mesh
        position={[0, height / 2, 0]}
        scale={displayScale}
        castShadow
        receiveShadow
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <boxGeometry args={[width, height, width]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={baseColor}
          emissiveIntensity={activeHover || isSelected ? emissiveIntensity * 1.8 : emissiveIntensity}
          metalness={0.2}
          roughness={0.5}
          transparent={avgGasUsed === 0}
          opacity={avgGasUsed === 0 ? 0.6 : 1}
        />
      </mesh>

      {/* Selected outline effect via secondary wireframe box */}
      {isSelected && (
        <mesh position={[0, height / 2, 0]} scale={[1.08, 1.02, 1.08]}>
          <boxGeometry args={[width, height, width]} />
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
