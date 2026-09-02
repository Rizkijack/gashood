import { OrbitControls } from "@react-three/drei";

export function CameraController() {
  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.05}
      autoRotate
      autoRotateSpeed={0.3}
      minDistance={5}
      maxDistance={40}
      maxPolarAngle={Math.PI / 2.5}
      minPolarAngle={0.1}
      target={[0, 0, 0]}
    />
  );
}

export default CameraController;
