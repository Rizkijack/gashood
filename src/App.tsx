import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState, Component, type ReactNode } from "react";
import { startCollecting, stopCollecting } from "@/data/gas-collector";
import { fetchGasHistory } from "@/data/history-client";
import { useGasStore } from "@/store/gas-store";
import { World } from "@/scene/World";
import { GasCity } from "@/scene/GasCity";
import { CameraController } from "@/scene/CameraController";
import { CameraFocus } from "@/scene/CameraFocus";
import { CITY_SCALE } from "@/scene/layout";
import { Dashboard } from "@/ui/Dashboard";
import { GasTable } from "@/ui/GasTable";
import { TxFeed } from "@/ui/TxFeed";
import { Legend } from "@/ui/Legend";
import { DetailPanel } from "@/ui/DetailPanel";
import { ErrorToast } from "@/ui/ErrorToast";
import { LoadingScreen } from "@/ui/LoadingScreen";

// ─── WebGL Support Check ─────────────────────────────────────────────
function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

// ─── Error Boundary for WebGL / Canvas errors ────────────────────────
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}
class SceneErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, errorMsg: "" };
  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return { hasError: true, errorMsg: err instanceof Error ? err.message : String(err) };
  }
  componentDidCatch(error: unknown) {
    console.error("[SceneErrorBoundary]", error);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

type Viewport = "mobile" | "tablet" | "desktop";

// ─── Minimal inline styles (no Tailwind needed) ──────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "relative",
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
    background: "#0a0a0f",
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  },
  canvasWrapper: {
    position: "absolute",
    inset: 0,
  },
  legendAnchor: {
    position: "absolute",
    left: 16,
    bottom: 16,
    zIndex: 15,
  },
  hint: {
    position: "absolute",
    bottom: 12,
    left: "50%",
    transform: "translateX(-50%)",
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    zIndex: 12,
    pointerEvents: "none",
    whiteSpace: "nowrap" as const,
  },
  toggleBtn: {
    position: "absolute",
    right: 16,
    bottom: 16,
    zIndex: 25,
    background: "rgba(10, 10, 15, 0.8)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    cursor: "pointer",
    boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
  },
  panelCard: {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    background: "rgba(10, 10, 15, 0.78)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#fff",
    zIndex: 18,
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.6)",
  },
  panelClose: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff",
    borderRadius: 6,
    width: 22,
    height: 22,
    cursor: "pointer",
    fontSize: 11,
    lineHeight: 1,
  },
  tableWrap: {
    overflowY: "auto",
    flexShrink: 0,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  feedWrap: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  feedTitle: {
    padding: "8px 12px 4px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.6)",
    flexShrink: 0,
  },
  fallback: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    background: "#0a0a0f",
    padding: 32,
    textAlign: "center" as const,
  },
  fallbackCard: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 24,
    maxWidth: 520,
  },
  loader: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    pointerEvents: "none" as const,
  },
};

/** Desktop (>1024): right side panel. Tablet (768–1024): bottom sheet. Mobile (<768): full-screen overlay. */
function placePanel(vp: Viewport): React.CSSProperties {
  if (vp === "desktop") {
    return { top: 58, right: 0, bottom: 0, width: 400, borderRadius: 0, borderRight: "none", borderTop: "none", borderBottom: "none" };
  }
  if (vp === "tablet") {
    return { left: 10, right: 10, bottom: 10, maxHeight: "44vh", borderRadius: 14 };
  }
  return { inset: 0, borderRadius: 0, border: "none" };
}

function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => {
    if (typeof window === "undefined") return "desktop";
    if (window.matchMedia("(min-width: 1025px)").matches) return "desktop";
    if (window.matchMedia("(min-width: 768px)").matches) return "tablet";
    return "mobile";
  });
  useEffect(() => {
    const mqDesktop = window.matchMedia("(min-width: 1025px)");
    const mqTablet = window.matchMedia("(min-width: 768px) and (max-width: 1024px)");
    const update = () => {
      if (mqDesktop.matches) setVp("desktop");
      else if (mqTablet.matches) setVp("tablet");
      else setVp("mobile");
    };
    update();
    mqDesktop.addEventListener("change", update);
    mqTablet.addEventListener("change", update);
    return () => {
      mqDesktop.removeEventListener("change", update);
      mqTablet.removeEventListener("change", update);
    };
  }, []);
  return vp;
}

/** Right overlay: GasTable + TxFeed, responsive placement (4.6). */
function AnalyticsPanel({ viewport, open, onClose }: { viewport: Viewport; open: boolean; onClose: () => void }) {
  if (!open) return null;

  // Tablet/mobile: compact table height so feed stays visible in the sheet.
  const tableMaxHeight = viewport === "desktop" ? 330 : viewport === "tablet" ? "40%" : "42%";

  return (
    <div style={{ ...styles.panelCard, ...placePanel(viewport) }}>
      <div style={styles.panelHeader}>
        <span>Network Analytics</span>
        <button style={styles.panelClose} onClick={onClose} title="Close panel">✕</button>
      </div>
      <div style={{ ...styles.tableWrap, maxHeight: tableMaxHeight }}>
        <GasTable />
      </div>
      <div style={styles.feedWrap}>
        <div style={styles.feedTitle}>Live Transactions</div>
        <TxFeed />
      </div>
    </div>
  );
}

// ─── Overlay layers (Fase 4) ─────────────────────────────────────────
function OverlayLayers() {
  const viewport = useViewport();
  // Desktop/tablet: panel visible by default. Mobile: hidden behind toggle (4.6).
  const [panelOpen, setPanelOpen] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 768,
  );

  // Auto-open when rotating out of mobile so the analytics stay reachable.
  useEffect(() => {
    if (viewport !== "mobile" && !panelOpen) setPanelOpen(true);
  }, [viewport, panelOpen]);

  return (
    <>
      <Dashboard />

      <div style={styles.legendAnchor}>
        <Legend />
      </div>

      {viewport === "desktop" && (
        <div style={styles.hint}>Drag to orbit · Scroll to zoom · Hover a row or building to highlight · Click for details</div>
      )}

      <AnalyticsPanel viewport={viewport} open={panelOpen} onClose={() => setPanelOpen(false)} />

      {!panelOpen && (
        <button style={styles.toggleBtn} onClick={() => setPanelOpen(true)} title="Open analytics panel">
          📊 Analytics
        </button>
      )}

      <DetailPanel />
    </>
  );
}

function WebGLFallbackView() {
  const { networkStats, isCollecting } = useGasStore();
  return (
    <div style={styles.fallback}>
      <div style={styles.fallbackCard}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️ WebGL Not Supported</div>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
          Your browser or device does not support WebGL, which is required for the 3D city view.
          You can still track gas data in the fallback table below.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            textAlign: "left" as const,
            fontSize: 13,
          }}
        >
          <div style={{ background: "rgba(255,255,255,0.06)", padding: 12, borderRadius: 8 }}>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, textTransform: "uppercase" as const }}>
              Status
            </div>
            <div style={{ fontFamily: "monospace", fontWeight: 700 }}>{isCollecting ? "Collecting" : "Stopped"}</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", padding: 12, borderRadius: 8 }}>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, textTransform: "uppercase" as const }}>
              Gas Price
            </div>
            <div style={{ fontFamily: "monospace", fontWeight: 700 }}>{networkStats.currentGasPrice.toFixed(4)} Gwei</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", padding: 12, borderRadius: 8 }}>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, textTransform: "uppercase" as const }}>Block</div>
            <div style={{ fontFamily: "monospace", fontWeight: 700 }}>#{networkStats.lastBlockNumber.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", padding: 12, borderRadius: 8 }}>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, textTransform: "uppercase" as const }}>Total Tx</div>
            <div style={{ fontFamily: "monospace", fontWeight: 700 }}>{networkStats.totalTransactions.toLocaleString()}</div>
          </div>
        </div>
        <p style={{ marginTop: 16, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
          Try a modern desktop browser with hardware acceleration enabled.
        </p>
      </div>
    </div>
  );
}

function SceneFallbackError() {
  return (
    <div style={{ ...styles.fallback, background: "#0a0a0f" }}>
      <div style={styles.fallbackCard}>
        <div style={{ fontSize: 20, marginBottom: 8 }}>Scene failed to load</div>
        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
          An unexpected WebGL error occurred. Please refresh or check console for details.
        </p>
      </div>
    </div>
  );
}

function Loader() {
  return <div style={styles.loader}>Loading 3D City…</div>;
}

export default function App() {
  const [webGLSupported, setWebGLSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setWebGLSupported(isWebGLAvailable());
  }, []);

  useEffect(() => {
    startCollecting();
    return () => stopCollecting();
  }, []);

  // 4.8 — Hydrate riwayat 24 jam dari snapshot git-scraper (data/snapshots.json).
  // TIDAK BOLEH menunda/menggagalkan loop live: fetch berjalan paralel,
  // kegagalan apa pun → null → diabaikan (fail-open). Seed hanya menempel
  // kalau store masih kosong (guard di seedFromSnapshot). Refresh tiap 5 menit
  // — sejalan dengan cadence collector GitHub Actions.
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const file = await fetchGasHistory();
      if (cancelled || !file || file.snapshots.length === 0) return;
      useGasStore.getState().seedFromSnapshot(file.snapshots[file.snapshots.length - 1]);
    };
    hydrate();
    const interval = setInterval(hydrate, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Still checking WebGL
  if (webGLSupported === null) {
    return (
      <div style={styles.root}>
        <Loader />
      </div>
    );
  }

  if (!webGLSupported) {
    return (
      <div style={styles.root}>
        <WebGLFallbackView />
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.canvasWrapper}>
        <SceneErrorBoundary fallback={<SceneFallbackError />}>
          <Suspense fallback={<Loader />}>
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
          </Suspense>
        </SceneErrorBoundary>
      </div>

      <OverlayLayers />
      <ErrorToast />
      <LoadingScreen />
    </div>
  );
}
