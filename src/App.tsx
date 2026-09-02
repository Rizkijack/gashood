import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState, Component, type ReactNode } from "react";
import { startCollecting, stopCollecting } from "@/data/gas-collector";
import { useGasStore } from "@/store/gas-store";
import { World } from "@/scene/World";
import { GasCity } from "@/scene/GasCity";
import { CameraController } from "@/scene/CameraController";

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
    inset: "0",
  },
  overlayTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 20px",
    background: "rgba(10, 10, 15, 0.72)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    color: "#fff",
    zIndex: 10,
    pointerEvents: "none",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: "-0.02em",
  },
  brandSub: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  stats: {
    display: "flex",
    gap: 20,
    alignItems: "center",
  },
  statItem: {
    textAlign: "right" as const,
  },
  statLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.45)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
  statValue: {
    fontSize: 13,
    fontFamily: "monospace",
    fontWeight: 600,
    color: "#fff",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    display: "inline-block",
    marginRight: 6,
  },
  overlayBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: "10px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(10,10,15,0.55)",
    backdropFilter: "blur(8px)",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    zIndex: 10,
    pointerEvents: "none",
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

function Overlay() {
  const { networkStats, isCollecting, error } = useGasStore();

  return (
    <>
      <div style={styles.overlayTop}>
        <div style={styles.brand}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "linear-gradient(135deg,#00FF88 0%,#00CCFF 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            ⛽
          </div>
          <div>
            <div style={styles.brandTitle}>GasHood</div>
            <div style={styles.brandSub}>Robinhood Chain · 3D Gas Tracker</div>
          </div>
        </div>

        <div style={styles.stats}>
          <div style={styles.statItem}>
            <div style={styles.statLabel}>Status</div>
            <div style={styles.statValue}>
              <span
                style={{
                  ...styles.statusDot,
                  background: isCollecting ? "#00FF88" : "#FFAA00",
                  boxShadow: isCollecting ? "0 0 8px #00FF88" : "none",
                }}
              />
              {isCollecting ? "Collecting" : "Idle"}
            </div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statLabel}>Gas Price</div>
            <div style={styles.statValue}>{networkStats.currentGasPrice.toFixed(4)} Gwei</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statLabel}>Block</div>
            <div style={styles.statValue}>#{networkStats.lastBlockNumber.toLocaleString()}</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statLabel}>Total Tx</div>
            <div style={styles.statValue}>{networkStats.totalTransactions.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            position: "absolute",
            top: 64,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(239,68,68,0.92)",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 12,
            zIndex: 11,
            maxWidth: "90vw",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      <div style={styles.overlayBottom}>
        <span>
          Drag to orbit · Scroll to zoom · Click building to select ·{" "}
          <span style={{ color: "#00FF88" }}>12 buildings mapped</span>
        </span>
        <span style={{ opacity: 0.5 }}>Fase 2 — 3D World Basic</span>
      </div>
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
              camera={{ position: [15, 12, 15], fov: 50 }}
              dpr={[1, 2]}
              shadows
              style={{ width: "100%", height: "100%", display: "block" }}
              gl={{ antialias: true, powerPreference: "high-performance" }}
              onCreated={({ gl }) => {
                gl.setClearColor("#0a0a0f");
              }}
            >
              <World>
                <GasCity />
              </World>
              <CameraController />
            </Canvas>
          </Suspense>
        </SceneErrorBoundary>
      </div>

      <Overlay />
    </div>
  );
}
