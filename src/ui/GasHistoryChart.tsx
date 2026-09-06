/**
 * 4.7 — Grafik riwayat harga gas 24 jam (SVG hand-rolled, TANPA dependency
 * chart). Data dari file snapshot git-scraper (data/snapshots.json, di-commit
 * GitHub Actions tiap ±1 jam) — fetch sendiri + state lokal, sengaja TIDAK
 * lewat store agar alur riwayat terpisah dari data live (simple).
 *
 * Gaya Ethereal Glass: stroke tipis, gradient fill 12% opacity, grid hairline,
 * tanpa shadow keras. Label waktu UTC+7 (WIB). Lebar responsif: lebar diukur
 * via ResizeObserver → viewBox mengikuti, font tetap konstan.
 */
import { useEffect, useRef, useState } from "react";
import { fetchGasHistory, type GasSnapshot } from "@/data/history-client";
import { useGasStore } from "@/store/gas-store";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // sumber riwayat ±1 jam → refresh 10 menit cukup
const HEIGHT = 150;
const PAD = { top: 12, right: 16, bottom: 24, left: 52 };
const STROKE = "#00CCFF";

const styles: Record<string, React.CSSProperties> = {
  wrap: { width: "100%" },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.6)",
  },
  hint: {
    fontSize: 9,
    color: "rgba(255,255,255,0.4)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  empty: {
    height: 64,
    display: "flex",
    alignItems: "center",
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
  },
};

/** Format jam menit UTC+7 (WIB) dari ISO string — manual via getUTC*, tanpa Intl. */
function formatWib(iso: string): string {
  const shifted = new Date(Date.parse(iso) + 7 * 60 * 60 * 1000);
  if (!Number.isFinite(shifted.getTime())) return "";
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function niceNumber(value: number): string {
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(3);
  return value.toFixed(4);
}

export function GasHistoryChart() {
  const [snapshots, setSnapshots] = useState<GasSnapshot[] | null>(null);
  // Nilai kini (live) untuk titik "sekarang" di ujung kanan — selector granular.
  const currentGasPrice = useGasStore((s) => s.networkStats.currentGasPrice);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  // Fetch riwayat saat mount + refresh berkala (sejalan cadence Actions ±1 jam).
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchGasHistory().then((file) => {
        if (!cancelled && file) setSnapshots(file.snapshots);
      });
    };
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Responsif: ukur lebar container → viewBox mengikuti (font tetap konstan).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const data = snapshots ?? [];
  if (data.length < 2) {
    return (
      <div ref={wrapRef} style={styles.wrap}>
        <div style={styles.title}>GAS PRICE · 24 JAM</div>
        <div style={styles.empty}>
          {snapshots === null ? "Memuat riwayat gas…" : "Riwayat belum cukup — menunggu snapshot berikutnya (±1 jam)"}
        </div>
      </div>
    );
  }

  const innerW = Math.max(width - PAD.left - PAD.right, 10);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const prices = data.map((s) => s.gasPriceGwei);
  // Sertakan nilai kini (live) dalam domain agar titik "sekarang" tetap terlihat.
  const candidates = currentGasPrice > 0 ? [...prices, currentGasPrice] : prices;
  const yMin = Math.min(...candidates);
  const yMax = Math.max(...candidates);
  const span = yMax - yMin;
  // Flat → beri ruang ±0.5 Gwei agar garis tidak menempel di satu pixel.
  const lo = span > 0 ? yMin - span * 0.1 : Math.max(0, yMin - 0.5);
  const hi = span > 0 ? yMax + span * 0.1 : yMax + 0.5;

  const xAt = (i: number) => PAD.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yAt = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * innerH;

  const linePath = data.map((s, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(s.gasPriceGwei).toFixed(1)}`).join(" ");
  const baseline = (PAD.top + innerH).toFixed(1);
  const areaPath = `${linePath} L${xAt(data.length - 1).toFixed(1)},${baseline} L${xAt(0).toFixed(1)},${baseline} Z`;

  // Grid hairline: 4 garis horizontal + label nilai di kiri.
  const gridLines = [0, 1, 2, 3].map((i) => {
    const value = hi - ((hi - lo) * i) / 3;
    const y = yAt(value);
    return { key: i, y, label: niceNumber(value) };
  });

  // 4-6 label waktu merata sepanjang sumbu X (UTC+7 WIB).
  const labelCount = Math.min(6, Math.max(4, Math.floor(innerW / 90)));
  const labelIndices = new Set<number>();
  for (let k = 0; k < labelCount; k++) {
    labelIndices.add(Math.round((k / (labelCount - 1)) * (data.length - 1)));
  }

  const last = data[data.length - 1];
  const lastX = xAt(data.length - 1);
  const lastY = yAt(last.gasPriceGwei);

  // Titik live digeser ke kanan agar tidak menumpuk titik snapshot terakhir.
  const liveX = Math.min(lastX + 10, width - 4);

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <div style={styles.header}>
        <div style={styles.title}>GAS PRICE · 24 JAM</div>
        <div style={styles.hint}>WIB · snapshot ±1 jam</div>
      </div>
      <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label="Riwayat harga gas 24 jam">
        <defs>
          <linearGradient id="gasHistoryFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={STROKE} stopOpacity={0.12} />
            <stop offset="100%" stopColor={STROKE} stopOpacity={0} />
          </linearGradient>
        </defs>

        {gridLines.map((g) => (
          <g key={g.key}>
            <line x1={PAD.left} x2={width - PAD.right} y1={g.y} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={PAD.left - 6} y={g.y + 3} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.4)" fontFamily="ui-monospace, monospace">
              {g.label}
            </text>
          </g>
        ))}

        {[...labelIndices].map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
            fontSize={9}
            fill="rgba(255,255,255,0.4)"
            fontFamily="ui-monospace, monospace"
          >
            {formatWib(data[i].t)}
          </text>
        ))}

        <path d={areaPath} fill="url(#gasHistoryFill)" />
        <path d={linePath} fill="none" stroke={STROKE} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Titik nilai terakhir snapshot + label gwei */}
        <circle cx={lastX} cy={lastY} r={3} fill={STROKE} />
        <text
          x={lastX - 6}
          y={Math.max(lastY - 8, 10)}
          textAnchor="end"
          fontSize={9}
          fill={STROKE}
          fontFamily="ui-monospace, monospace"
        >
          {niceNumber(last.gasPriceGwei)}
        </text>

        {/* Titik nilai kini (live) — digeser ke kanan dari titik snapshot terakhir, dihubungkan garis putus-putus (snapshot → sekarang) */}
        {currentGasPrice > 0 &&
          (() => {
            const liveY = yAt(currentGasPrice);
            return (
              <>
                <line x1={lastX} y1={lastY} x2={liveX} y2={liveY} stroke="#00FF88" strokeWidth={1} strokeDasharray="2 2" opacity={0.6} />
                <circle cx={liveX} cy={liveY} r={3} fill="#00FF88" />
                <text
                  x={liveX - 6}
                  y={Math.max(liveY - 8, 10)}
                  textAnchor="end"
                  fontSize={9}
                  fill="#00FF88"
                  fontFamily="ui-monospace, monospace"
                >
                  {niceNumber(currentGasPrice)}
                </text>
              </>
            );
          })()}
      </svg>
    </div>
  );
}

export default GasHistoryChart;
