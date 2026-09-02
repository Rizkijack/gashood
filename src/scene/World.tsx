import { Environment } from "@react-three/drei";
import { Suspense, type ReactNode } from "react";

interface WorldProps {
  children?: ReactNode;
}

export function World({ children }: WorldProps) {
  return (
    <>
      {/* Fog for depth */}
      <fog attach="fog" args={["#0a0a0f", 20, 50]} />

      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight
        intensity={0.8}
        position={[10, 15, 5]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />

      {/* Ground plane — surface at y=0 (konsisten dengan base bangunan di y=0) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#0a0a0f" roughness={0.8} metalness={0.1} />
      </mesh>

      {/* Subtle grid helper on top of ground */}
      <gridHelper args={[30, 30, "#1a1a2e", "#1a1a2e"]} position={[0, 0.01, 0]} />

      {/* Environment map for reflections (suspends while HDR loads) */}
      <Suspense fallback={null}>
        <Environment preset="city" />
      </Suspense>

      {/* Scene content */}
      {children}
    </>
  );
}

export default World;
