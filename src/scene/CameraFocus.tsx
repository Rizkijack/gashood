import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useGasStore } from "@/store/gas-store";
import { CITY_SCALE, getBuildingPosition } from "./layout";

// Semua jarak/offset kamera ×CITY_SCALE — posisi bangunan otomatis ikut
// layout baru; konstanta inilah yang tadinya di-hardcode untuk kota kecil.
// Di-export: dipakai App.tsx (posisi awal Canvas) & DataRiver (seed fresnel)
// agar tidak ada angka kamera yang divergensi.
export const DEFAULT_CAMERA: readonly [number, number, number] = [
  15 * CITY_SCALE,
  12 * CITY_SCALE,
  15 * CITY_SCALE,
];
const FOCUS_TARGET_Y = 1.2 * CITY_SCALE;
const LERP_TARGET = 0.07;
const LERP_CAMERA = 0.06;
const FOCUS_MIN_DIST = 5 * CITY_SCALE;
const FOCUS_MAX_DIST = 9 * CITY_SCALE;
const SETTLE_EPSILON = 0.3 * CITY_SCALE;

type Phase = "idle" | "focus" | "return";

/**
 * Camera focus (Fase 4.5).
 * Reads store.selectedType and smoothly moves the OrbitControls target +
 * camera to the corresponding building's grid position (see ./layout).
 * Renders inside the <Canvas>; does NOT modify CameraController.
 * Closing (selectedType → null) returns the camera to the default overview.
 */
export function CameraFocus() {
  const selectedType = useGasStore((s) => s.selectedType);
  const camera = useThree((s) => s.camera);
  // drei's OrbitControls registers itself as state.controls
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;

  const phase = useRef<Phase>("idle");

  const goal = (() => {
    if (!selectedType) return null;
    const [x, , z] = getBuildingPosition(selectedType);
    return { x, z };
  })();

  useEffect(() => {
    if (selectedType) {
      phase.current = "focus";
      if (controls) controls.autoRotate = false;
    } else {
      phase.current = "return";
      if (controls) controls.autoRotate = true;
    }
  }, [selectedType, controls]);

  useFrame(() => {
    if (!controls) return;
    const c = controls;
    const p = phase.current;

    if (p === "focus" && goal) {
      // 1) Keep target glued to the building (always, so manual orbit re-centers).
      c.target.x += (goal.x - c.target.x) * LERP_TARGET;
      c.target.y += (FOCUS_TARGET_Y - c.target.y) * LERP_TARGET;
      c.target.z += (goal.z - c.target.z) * LERP_TARGET;

      // 2) Ease camera inward toward the building, preserving view direction.
      const dx = camera.position.x - c.target.x;
      const dy = camera.position.y - c.target.y;
      const dz = camera.position.z - c.target.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const goalDist = Math.min(Math.max(dist * 0.45, FOCUS_MIN_DIST), FOCUS_MAX_DIST);
      const gx = c.target.x + (dx / dist) * goalDist;
      const gy = c.target.y + (dy / dist) * goalDist;
      const gz = c.target.z + (dz / dist) * goalDist;

      const camNear = Math.hypot(gx - camera.position.x, gy - camera.position.y, gz - camera.position.z) < SETTLE_EPSILON;
      if (!camNear) {
        camera.position.x += (gx - camera.position.x) * LERP_CAMERA;
        camera.position.y += (gy - camera.position.y) * LERP_CAMERA;
        camera.position.z += (gz - camera.position.z) * LERP_CAMERA;
      }
    } else if (p === "return") {
      c.target.x += (0 - c.target.x) * LERP_TARGET;
      c.target.y += (0 - c.target.y) * LERP_TARGET;
      c.target.z += (0 - c.target.z) * LERP_TARGET;

      camera.position.x += (DEFAULT_CAMERA[0] - camera.position.x) * LERP_CAMERA;
      camera.position.y += (DEFAULT_CAMERA[1] - camera.position.y) * LERP_CAMERA;
      camera.position.z += (DEFAULT_CAMERA[2] - camera.position.z) * LERP_CAMERA;

      const settled =
        Math.hypot(
          DEFAULT_CAMERA[0] - camera.position.x,
          DEFAULT_CAMERA[1] - camera.position.y,
          DEFAULT_CAMERA[2] - camera.position.z,
        ) < SETTLE_EPSILON;
      if (settled) phase.current = "idle";
    }

    c.update();
  });

  return null;
}

export default CameraFocus;
