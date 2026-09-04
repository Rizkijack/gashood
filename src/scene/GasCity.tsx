import { GasBuilding } from "./GasBuilding";
import { getBuildingPosition, TX_TYPES_ORDERED } from "./layout";

// Refactor 12 → 4 kategori: 4 gedung, satu baris tengah z=0.
// Positions & type order come from ./layout — the single source of truth
// shared with GasParticles & CameraFocus.
export function GasCity() {
  return (
    <group>
      {TX_TYPES_ORDERED.map((txType) => {
        const position = getBuildingPosition(txType);
        return <GasBuilding key={txType} txType={txType} position={position} />;
      })}
    </group>
  );
}

export default GasCity;
