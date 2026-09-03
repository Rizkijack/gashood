import { OrbitControls } from "@react-three/drei";
import { CITY_SCALE } from "./layout";

export function CameraController() {
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.05}
      autoRotate
      autoRotateSpeed={0.3}
      // Jarak orbit ×CITY_SCALE — kamera harus membingkai kota 15× lebih luas
      // (grid ±105, skyline hingga 120 unit tinggi).
      minDistance={5 * CITY_SCALE}
      maxDistance={40 * CITY_SCALE}
      maxPolarAngle={Math.PI / 2.5}
      minPolarAngle={0.1}
      target={[0, 0, 0]}
    />
  );
}

export default CameraController;
