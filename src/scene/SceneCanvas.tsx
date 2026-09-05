import { Canvas } from "@react-three/fiber";
import { World } from "@/scene/World";
import { GasCity } from "@/scene/GasCity";
import { CameraController } from "@/scene/CameraController";
import { CameraFocus } from "@/scene/CameraFocus";
import { CITY_SCALE } from "@/scene/layout";

export default function SceneCanvas() {
  return (
    <Canvas
      // Posisi kamera ×CITY_SCALE (mengikuti DEFAULT_CAMERA CameraFocus);
      // near 2 / far 2000 — near 2 melipatgandakan presisi depth buffer
      // (ambang Δz ≈ 0.021 → 0.011 di jarak 600) demi lapisan tanah/
      // marka bebas z-fighting, sementara far 2000 tetap memuat sky
      // dome radius 50×CITY_SCALE=750 tanpa ter-clip.
      camera={{
        position: [15 * CITY_SCALE, 12 * CITY_SCALE, 15 * CITY_SCALE],
        fov: 50,
        near: 2,
        far: 2000,
      }}
      // GPU churn fix: cap 1.5 (dari 2) — dpr tinggi melipatgandakan
      // fill-rate untuk canvas + composer; 1.5 masih tajam di layar umum.
      dpr={[1, 1.5]}
      // PCFSoftShadowMap — bayangan gedung/pohon soft-diffused
      // (Ethereal Glass: dilarang kontras kasar). Zero cost signifikan.
      shadows="soft"
      style={{ width: "100%", height: "100%", display: "block" }}
      // antialias off: EffectComposer (World.tsx) merender ke render target
      // dan menggambar full-screen quad — MSAA canvas asli jadi redundan.
      gl={{ antialias: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor("#0a0a0f");
      }}
    >
      <World>
        <GasCity />
      </World>
      <CameraController />
      <CameraFocus />
    </Canvas>
  );
}
