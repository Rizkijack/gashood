import { useEffect } from "react";
import { useGasStore } from "@/store/gas-store";

const styles: Record<string, React.CSSProperties> = {
  toast: {
    position: "fixed",
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "rgba(239, 68, 68, 0.92)",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: 10,
    fontSize: 12,
    zIndex: 60,
    maxWidth: "90vw",
    textAlign: "center" as const,
    boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
  },
  dismiss: {
    background: "rgba(255,255,255,0.15)",
    border: "none",
    color: "#fff",
    width: 22,
    height: 22,
    borderRadius: 999,
    cursor: "pointer",
    fontSize: 11,
    lineHeight: 1,
    flexShrink: 0,
  },
};

/** L31: setelah 3 kegagalan → pesan berubah jadi "menggunakan data cache". */
const CACHED_DATA_THRESHOLD = 3;

/**
 * L31 — Error toast dengan pesan GENERIK.
 * Audit security: `error.message` dari RPC TIDAK pernah dirender ke UI karena
 * bisa bocor detail internal (URL endpoint, status code, stack). Detail hanya
 * dikirim ke `console.error`.
 *
 * Hitungan kegagalan dibaca dari store (`consecutiveFailures` — di-increment
 * collector tiap cycle gagal, reset saat sukses), BUKAN state lokal: error
 * yang identik antar-polling (viem HttpRequestError deterministik) tidak
 * memicu re-render, sehingga counter lokal tidak pernah naik saat outage
 * persisten.
 */
export function ErrorToast() {
  const error = useGasStore((s) => s.error);
  const failures = useGasStore((s) => s.consecutiveFailures);

  useEffect(() => {
    if (error) {
      // Detail internal → console saja, bukan UI.
      console.error("[rpc] polling error:", error);
    }
  }, [error]);

  if (!error) return null;

  const message =
    failures >= CACHED_DATA_THRESHOLD
      ? "Koneksi ke Robinhood Chain gagal. Menggunakan data cache. Retrying..."
      : "Gagal menghubungi Robinhood Chain. Retrying...";

  return (
    <div style={styles.toast} role="alert">
      <span style={{ flex: 1 }}>
        {message}
        {failures > 1 ? ` (percobaan ke-${failures})` : ""}
      </span>
      <button
        style={styles.dismiss}
        onClick={() => useGasStore.getState().setError(null)}
        aria-label="Tutup notifikasi error"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export default ErrorToast;
