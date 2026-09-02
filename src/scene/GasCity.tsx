import { TxType } from "@/data/tx-classifier";
import { GasBuilding } from "./GasBuilding";

/**
 * Grid 4×3, spacing 4 units, center at 0,0.
 * For Fase 2 we use full grid (DataRiver not yet present).
 */
const TX_TYPES_ORDERED: TxType[] = [
  TxType.NATIVE_TRANSFER,
  TxType.ERC20_TRANSFER,
  TxType.ERC20_APPROVE,
  TxType.DEX_SWAP,
  TxType.LIQUIDITY,
  TxType.BRIDGE_DEPOSIT,
  TxType.BRIDGE_WITHDRAW,
  TxType.NFT_TRANSFER,
  TxType.NFT_MINT,
  TxType.CONTRACT_DEPLOY,
  TxType.CONTRACT_CALL,
  TxType.RWA_TOKEN,
];

const SPACING = 4;

function indexToPosition(index: number): [number, number, number] {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const x = (col - 1.5) * SPACING;
  const z = (row - 1) * SPACING;
  return [x, 0, z];
}

export function GasCity() {
  return (
    <group>
      {TX_TYPES_ORDERED.map((txType, index) => {
        const position = indexToPosition(index);
        return <GasBuilding key={txType} txType={txType} position={position} />;
      })}
    </group>
  );
}

export default GasCity;
