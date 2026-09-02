import { useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";
import { useGasStore } from "@/store/gas-store";

// Minimal inline styles — konsisten dengan App.tsx (dark, rgba blur).
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    background: "rgba(10, 10, 15, 0.92)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    color: "#fff",
    transition: "opacity 500ms ease",
    // Overlay loading tidak butuh interaksi sama sekali — selalu tembus klik
    // agar tidak pernah memblok app di belakangnya.
    pointerEvents: "none",
  },
  logo: { fontSize: 44, lineHeight: 1 },
  title: { fontSize: 20, fontWeight: 800, letterSpacing: "0.04em" },
  status: { fontSize: 12, color: "rgba(255,255,255,0.55)" },
  track: {
    width: 240,
    height: 4,
    borderRadius: 999,
    background: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  bar: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #00FF88, #88BB44)",
    transition: "width 300ms ease",
  },
  pct: {
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "rgba(255,255,255,0.4)",
  },
};

/** L30: give-up — overlay loading jangan memblok app tanpa batas. */
const GIVE_UP_MS = 15_000;

/**
 * 5.2 / L30 — Loading screen saat:
 *   1. aset 3D (Environment HDR) masih di-load — `useProgress` dari drei, ATAU
 *   2. data pertama belum ada — collector jalan (`isCollecting`) tapi belum ada
 *      tx yang masuk store (`recentTxs` kosong).
 * Fade-out 500ms saat keduanya siap, lalu unmount. Tidak flash saat semua
 * sudah ter-cache.
 */
export function LoadingScreen() {
  const { active, progress } = useProgress();
  const isCollecting = useGasStore((s) => s.isCollecting);
  const hasFirstData = useGasStore((s) => s.recentTxs.length > 0);

  const loading = active || (isCollecting && !hasFirstData);
  const [timedOut, setTimedOut] = useState(false);
  const show = loading && !timedOut;
  const [visible, setVisible] = useState(show);

  // Give-up 15 detik: data pertama tak kunjung datang → paksa sembunyikan
  // overlay (fade-out sama) agar tidak memblok app tanpa batas. Timer di-reset
  // saat loading selesai natural dan di-cleanup di effect.
  useEffect(() => {
    if (loading) {
      const t = setTimeout(() => setTimedOut(true), GIVE_UP_MS);
      return () => clearTimeout(t);
    }
    setTimedOut(false);
  }, [loading]);

  // Saat loading selesai: tahan 500ms untuk transisi fade-out, lalu unmount.
  useEffect(() => {
    if (show) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 500);
    return () => clearTimeout(t);
  }, [show]);

  if (!visible) return null;

  const pct = Math.round(progress);

  return (
    <div
      style={{ ...styles.overlay, opacity: show ? 1 : 0 }}
      role="status"
      aria-live="polite"
      aria-label="Loading GasHood"
    >
      <div style={styles.logo}>⛽</div>
      <div style={styles.title}>GasHood</div>
      <div style={styles.status}>Connecting to Robinhood Chain...</div>
      <div style={styles.track}>
        <div style={{ ...styles.bar, width: `${pct}%` }} />
      </div>
      <div style={styles.pct}>{pct}%</div>
    </div>
  );
}

export default LoadingScreen;
