import { Billboard, Text } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TxType } from "@/data/tx-classifier";
import { useGasStore } from "@/store/gas-store";
import { CITY_SCALE, buildingHeight } from "./layout";
import { GAS_BRACKETS } from "@/ui/tx-theme";
import {
  PODIUM_HEIGHT,
  PODIUM_WIDTH,
  applyFacadeRepeat,
  getFacadeMaterialParams,
  getFacadeTextures,
  getPodiumGeometry,
  getPodiumTextures,
  getRoofCapGeometry,
  getRoofEmissiveTexture,
  getTopStackWidth,
  getTowerGeometry,
  registerRooftopLive,
  unregisterRooftopLive,
  type RooftopLiveState,
} from "./BuildingFacade";

interface GasBuildingProps {
  txType: TxType;
  position: [number, number, number];
}

// Tinggi cap atap (world units, skala gedung ×CITY_SCALE) — tidak ikut scale
// tinggi bangunan per-frame, tapi proporsional terhadap gedung baru.
const ROOF_HEIGHT = 0.15 * CITY_SCALE;
// Cap atap sedikit lebih lebar dari stack teratas (parapet menjorok keluar).
const ROOF_MARGIN = 1.05;

/** Parse hex color ke [r, g, b] (0–1) */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

/** Lerp antara dua warna hex, t ∈ [0, 1] */
function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round((r1 + (r2 - r1) * t) * 255);
  const g = Math.round((g1 + (g2 - g1) * t) * 255);
  const blue = Math.round((b1 + (b2 - b1) * t) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

/**
 * Smooth color interpolation dari GAS_BRACKETS (barometer).
 * Low gwei → hijau, high gwei → merah.
 * Interpolasi linear antara bracket endpoints.
 */
function getColorForGasPrice(avgGasPrice: number): string {
  if (avgGasPrice <= 0) return "#333344";

  // Cari bracket yang cocok
  for (let i = 0; i < GAS_BRACKETS.length; i++) {
    const bracket = GAS_BRACKETS[i];
    const min = bracket.min ?? -Infinity;
    const max = bracket.max ?? Infinity;

    if (avgGasPrice >= min && avgGasPrice < max) {
      // Interpolasi di dalam bracket ini
      if (i < GAS_BRACKETS.length - 1 && bracket.max != null) {
        const next = GAS_BRACKETS[i + 1];
        const range = bracket.max - min;
        if (range > 0) {
          const t = (avgGasPrice - min) / range;
          return lerpColor(bracket.color, next.color, t);
        }
      }
      return bracket.color;
    }
  }

  // Di atas semua bracket → warna terakhir (merah)
  return GAS_BRACKETS[GAS_BRACKETS.length - 1].color;
}

function formatLabel(txType: string): string {
  return txType.replace(/_/g, " ").toUpperCase();
}

/* ---- Arsitektur prosedural (BuildingFacade.tsx) --------------------------
 * Semua tekstur (albedo+emissive jendela, podium) dan geometri tower
 * (merge stack setback) dibuat SEKALI di module-cache helper — bukan per
 * render. Arketipe deterministik per TxType:
 *   glass    — menara kaca modern   | concrete — beton mid-rise rulek
 *   setback  — menara 3 stack       |
 * Draw call per bangunan: tower(1) + podium(1) + cap(1) = 3 (sama dgn lama).
 * Detail rooftop (AC/antena/water tower) = instancing GLOBAL, lihat
 * RooftopDetails di BuildingFacade.tsx (mount sekali di World). */

export function GasBuilding({ txType, position }: GasBuildingProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Subscribe ke metrics store untuk txType ini (kontrak dipertahankan).
  const metric = useGasStore((s) => s.gasMetrics.get(txType));
  const hoveredType = useGasStore((s) => s.hoveredType);
  const selectedType = useGasStore((s) => s.selectedType);

  const avgGasPrice = metric?.avgGasPrice ?? 0;
  const recentTxCount = metric?.recentTxCount ?? 0;

  // Height mapping — gauge gas price real-time (Blockscout gas tracker):
  // re-anchor ke range Robinhood (0.1 Gwei → MIN 7.5), naik linear @
  // 1 Gwei = 50m, clamp 7.5–150. Rumus SATU SUMBER di layout.ts — dipakai juga
  // GasParticles agar spawn tidak pernah di dalam menara.
  const height = useMemo(() => buildingHeight(avgGasPrice), [avgGasPrice]);

  // Width mapping (BUILD_STEPS.md Langkah 12): normalize(recentTxCount, 0, 50) * 1.5 + 0.5,
  // lalu ×CITY_SCALE (maks 30 unit) — footprint gedung ikut skala kota.
  const width = useMemo(() => {
    return (Math.min(recentTxCount / 50, 1) * 1.5 + 0.5) * CITY_SCALE;
  }, [recentTxCount]);

  const baseColor = useMemo(() => getColorForGasPrice(avgGasPrice), [avgGasPrice]);

  // Tekstur fasad — master strip di-cache per warna bracket (≤7 entri);
  // helper mengembalikan CLONE per bangunan (texture.repeat = properti
  // Texture, tiap gedung butuh transform sendiri karena tinggi lerp beda).
  // Clone lama di-dispose saat baseColor berganti/unmount — master tetap
  // hidup di cache modul.
  const facade = useMemo(() => getFacadeTextures(baseColor), [baseColor]);
  useEffect(() => {
    return () => {
      facade.map.dispose();
      facade.emissiveMap.dispose();
      facade.roughnessMap.dispose();
    };
  }, [facade]);
  const towerGeometry = useMemo(() => getTowerGeometry(txType), [txType]);
  const facadeParams = useMemo(() => getFacadeMaterialParams(txType), [txType]);
  const topStackWidth = useMemo(() => getTopStackWidth(txType), [txType]);
  const podiumTextures = useMemo(() => getPodiumTextures(), []);
  const podiumGeometry = useMemo(() => getPodiumGeometry(), []);
  // Cap atap: geometri UV-redirect + tekstur hairline (cache module-scope).
  const roofGeometry = useMemo(() => getRoofCapGeometry(), []);
  const roofEmissive = useMemo(() => getRoofEmissiveTexture(), []);

  // Warna turunan podium & atap: baseColor digelapkan ~28-30% — dihitung
  // sekali saat baseColor berubah via useMemo, BUKAN per frame (AC).
  const podiumColor = useMemo(() => new THREE.Color(baseColor).multiplyScalar(0.7), [baseColor]);
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
  // GROUP = tower + podium + cap (AC: lerp diterapkan ke group). Podium/cap
  // counter-scale sumbu Y agar tinggi dunianya tetap (tidak ikut memanjang).
  const groupRef = useRef<THREE.Group>(null);
  const podiumRef = useRef<THREE.Mesh>(null);
  const roofRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const podiumMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const roofMatRef = useRef<THREE.MeshStandardMaterial>(null);

  // State animasi per bangunan (tanpa alokasi per frame)
  const currentHeightRef = useRef<number | null>(null); // null = snap frame pertama
  const currentColorRef = useRef(new THREE.Color(baseColor));
  const targetColorRef = useRef(new THREE.Color(baseColor));
  const lastBaseColorRef = useRef(baseColor);

  // State pulse
  const pulseRef = useRef(0);
  const prevTxCountRef = useRef(0);

  // Registry live-state untuk RooftopDetails (instancing global) — objek yang
  // sama dipakai ulang, GasBuilding hanya menulis field tiap frame (0 alokasi).
  const liveRef = useRef<RooftopLiveState | null>(null);
  useEffect(() => {
    liveRef.current = registerRooftopLive(txType);
    return () => {
      unregisterRooftopLive(txType);
      liveRef.current = null;
    };
  }, [txType]);

  useFrame(() => {
    const group = groupRef.current;
    const mat = matRef.current;
    if (!group || !mat) return;

    // (a) L17 — lerp tinggi (faktor 0.05); posisi y = height/2 agar bangunan
    // tumbuh dari lantai (group origin = dasar bangunan; tower unit di [0,0,0]
    // → world span [0, height]). Lerp ke GROUP scale [width, height, width].
    if (currentHeightRef.current === null) currentHeightRef.current = height;
    currentHeightRef.current = THREE.MathUtils.lerp(currentHeightRef.current, height, 0.05);
    const currentHeight = currentHeightRef.current;

    // Fasad tile berulang: jumlah lantai & kolom jendela mengikuti nilai
    // LERP saat itu → jendela tetap berukuran fisik (~0.5 unit/lantai)
    // saat gedung tumbuh/menyusut tiap poll. Set repeat per frame — murah,
    // tanpa alokasi, tanpa popping (derivasi di applyFacadeRepeat).
    applyFacadeRepeat(facade.map, facade.emissiveMap, facade.roughnessMap, currentHeight, width);

    // (a) L17 — lerp warna (faktor 0.03), tanpa alokasi. Target hanya di-parse
    // saat baseColor berubah (re-render oleh store), bukan per frame.
    if (lastBaseColorRef.current !== baseColor) {
      targetColorRef.current.set(baseColor);
      lastBaseColorRef.current = baseColor;
    }
    currentColorRef.current.lerp(targetColorRef.current, 0.03);
    mat.color.copy(currentColorRef.current);
    mat.emissive.copy(currentColorRef.current); // glow lewat emissiveMap jendela

    // Turunan warna podium & cap ikut lerp (copy+multiplyScalar, 0 alokasi).
    const podiumMat = podiumMatRef.current;
    if (podiumMat) {
      podiumMat.color.copy(currentColorRef.current).multiplyScalar(0.7);
      podiumMat.emissive.copy(currentColorRef.current);
    }
    const roofMat = roofMatRef.current;
    if (roofMat) {
      roofMat.color.copy(currentColorRef.current).multiplyScalar(0.72);
      // Hairline parapet: emissive = warna bracket (lerp) × emissiveMap garis
      // 2px; intensitas statis 0.22 (restrained) — set 0 alokasi per frame.
      roofMat.emissive.copy(currentColorRef.current);
    }

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

    // Podium/lobby: tinggi dunia tetap (PODIUM_HEIGHT), lebar PODIUM_WIDTH×
    // tower (1.08 — margin bank batu z=16.35 & clearance sungai DataRiver).
    // Counter-scale sumbu Y terhadap group yang diskalakan tinggi bangunan.
    const podium = podiumRef.current;
    if (podium) {
      podium.scale.set(PODIUM_WIDTH, PODIUM_HEIGHT / sclY, PODIUM_WIDTH);
      podium.position.y = (PODIUM_HEIGHT / 2 - currentHeight / 2) / sclY;
    }

    // Cap atap/parapet: melekat di atas stack TERATAS (setback → cap lebih
    // kecil), tinggi dunia tetap ROOF_HEIGHT. Ikut pulse/hover via group.
    const roof = roofRef.current;
    if (roof) {
      roof.scale.set(topStackWidth * ROOF_MARGIN, ROOF_HEIGHT / sclY, topStackWidth * ROOF_MARGIN);
      roof.position.y = (currentHeight / 2 + ROOF_HEIGHT / 2) / sclY;
    }

    // RooftopDetails membaca ini untuk menempelkan AC/antena/water tower di
    // atas cap — mengikuti lerp/pulse/hover, bukan angka target statis.
    const live = liveRef.current;
    if (live) {
      live.topY = (currentHeight + sclY) / 2 + ROOF_HEIGHT;
      live.halfTopWidth = (sclX / 2) * topStackWidth;
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
        ARSITEKTUR baru: tower fasad prosedural + podium lobby + cap atap,
        semua dalam SATU group animasi (origin = dasar bangunan).
        - Geometri tower di-cache per TxType (merge stack setback) — SATU mesh
          → 1 draw call walau bertingkat.
        - useFrame me-lerp scale/posisi group; mesh anak counter-scale Y.
        - Podium 1.08× lebar tower → bangunan "tumbuh dari jalan".
      */}
      <group
        ref={groupRef}
        position={[0, height / 2, 0]}
        scale={[width, height, width]}
      >
        {/* Tower — merge stack + tekstur jendela per lantai (map+emissiveMap).
            Material berlapis (Ethereal Glass): roughnessMap noise (kilap tidak
            seragam) + vertexColors fake-AO (kaki gedung lebih gelap).
            Kaca arketipe glass memanfaatkan Environment preset="city" via
            envMapIntensity restrained (refleksi langit di kaca biru gelap). */}
        <mesh
          geometry={towerGeometry}
          castShadow
          receiveShadow
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          {/* color/emissive/emissiveIntensity dimiliki useFrame (lerp + pulse) */}
          <meshStandardMaterial
            ref={matRef}
            map={facade.map}
            emissiveMap={facade.emissiveMap}
            roughnessMap={facade.roughnessMap}
            vertexColors
            metalness={facadeParams.metalness}
            roughness={facadeParams.roughness}
            envMapIntensity={facadeParams.envMapIntensity}
            transparent={avgGasPrice === 0}
            opacity={avgGasPrice === 0 ? 0.6 : 1}
          />
        </mesh>

        {/* Podium/lobby: batu gelap + pita kaca pintu masuk menyala (emissive).
            1.08× lebar tower (margin bank batu z=16.35 saat width maks — lihat
            PODIUM_WIDTH di BuildingFacade), tinggi dunia tetap 0.34 (~2 lantai
            stylized). Handler pointer sama dengan tower → tidak ada dead-zone
            hover/click. */}
        <mesh
          ref={podiumRef}
          geometry={podiumGeometry}
          position={[0, (PODIUM_HEIGHT / 2 - height / 2) / (height * hoverBoost), 0]}
          scale={[PODIUM_WIDTH, PODIUM_HEIGHT / (height * hoverBoost), PODIUM_WIDTH]}
          castShadow
          receiveShadow
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <meshStandardMaterial
            ref={podiumMatRef}
            map={podiumTextures.map}
            emissiveMap={podiumTextures.emissiveMap}
            color={podiumColor}
            emissiveIntensity={0.8}
            metalness={0.25}
            roughness={0.55}
            envMapIntensity={0.5}
            transparent={avgGasPrice === 0}
            opacity={avgGasPrice === 0 ? 0.6 : 1}
          />
        </mesh>

        {/* Cap atap/parapet: menutup stack teratas (lebar mengikuti arketipe —
            setback → cap lebih kecil). Metalness tinggi (machined hardware),
            warna senada lebih gelap + HAIRLINE light edge di tepi atas sisi
            parapet via emissiveMap garis tipis (emissive = bracket color ×
            0.22 — restrained, kesan cahaya lantai atap; deck tidak menyala —
            UV atap/dasar diarahkan ke area hitam canvas).
            Handler pointer sama dengan tower → tidak ada dead-zone hover/click. */}
        <mesh
          ref={roofRef}
          geometry={roofGeometry}
          position={[0, (height / 2 + ROOF_HEIGHT / 2) / (height * hoverBoost), 0]}
          scale={[topStackWidth * ROOF_MARGIN, ROOF_HEIGHT / (height * hoverBoost), topStackWidth * ROOF_MARGIN]}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <meshStandardMaterial
            ref={roofMatRef}
            color={roofColor}
            emissiveMap={roofEmissive}
            emissiveIntensity={0.22}
            metalness={0.7}
            roughness={0.3}
            envMapIntensity={0.8}
            transparent={avgGasPrice === 0}
            opacity={avgGasPrice === 0 ? 0.6 : 1}
          />
        </mesh>

        {/* Selected outline via wireframe box — child group: skala lokal statis
            1.08× group (AC), mengikuti animasi group tanpa update per frame.
            Posisi origin group (dasar bangunan) + scale y 1.02 → membungkus
            tower [0, height] tanpa melayang. */}
        {isSelected && (
          <mesh position={[0, 0, 0]} scale={[1.08, 1.02, 1.08]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={baseColor} wireframe transparent opacity={0.35} />
          </mesh>
        )}
      </group>

      {/* Floating label — wrapped in <Billboard> agar selalu menghadap kamera
          (drei <Text> tidak auto-billboard). Di luar group animasi → tidak ikut
          scale bangunan (perilaku lama dipertahankan). Gap & ukuran teks
          ×CITY_SCALE agar proporsional dengan gedung 7.5–120 unit dan tetap
          terbaca dari jarak kota; jelas di atas antena rooftop. */}
      <Billboard position={[0, height + 1.0 * CITY_SCALE, 0]}>
        <Text
          fontSize={0.3 * CITY_SCALE}
          color="#fff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02 * CITY_SCALE}
          outlineColor="#000000"
          maxWidth={2 * CITY_SCALE}
          textAlign="center"
        >
          {labelText}
        </Text>
      </Billboard>

      {/* Secondary small label for gas price when active — di atas water tower
          (gap setengah dari label utama, proporsional ×CITY_SCALE). */}
      {avgGasPrice > 0 && (
        <Billboard position={[0, height + 0.52 * CITY_SCALE, 0]}>
          <Text
            fontSize={0.14 * CITY_SCALE}
            color={baseColor}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.01 * CITY_SCALE}
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
