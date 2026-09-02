import { useMemo } from "react";
import { useGasStore } from "@/store/gas-store";
import { formatEth, formatGasPrice, formatNumber, formatTxHash } from "@/utils/format";
import { TX_COLORS, TX_LABELS } from "./tx-theme";

const EXPLORER = "https://robinhoodchain.blockscout.com/tx/";
const MAX_RECENT_IN_PANEL = 8;

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "min(400px, 94vw)",
    background: "rgba(12, 12, 18, 0.88)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    borderLeft: "1px solid rgba(255,255,255,0.1)",
    color: "#fff",
    zIndex: 30,
    display: "flex",
    flexDirection: "column",
    animation: "ghPanelIn 0.28s cubic-bezier(0.2, 0.8, 0.3, 1)",
    boxShadow: "-12px 0 32px rgba(0,0,0,0.45)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    flexShrink: 0,
  },
  dot: { width: 10, height: 10, borderRadius: 999, flexShrink: 0 },
  title: { fontSize: 14, fontWeight: 700 },
  trend: { fontSize: 12, opacity: 0.7 },
  close: {
    marginLeft: "auto",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff",
    borderRadius: 8,
    width: 28,
    height: 28,
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1,
    flexShrink: 0,
  },
  body: { flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 14 },
  sectionTitle: { fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.45)" },
  statsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  statCard: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "8px 10px" },
  statLabel: { fontSize: 9, color: "rgba(255,255,255,0.45)", textTransform: "uppercase" as const, letterSpacing: "0.05em" },
  statValue: { fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 600, marginTop: 2 },
  txList: { display: "flex", flexDirection: "column", gap: 4 },
  txItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 6,
    background: "rgba(255,255,255,0.03)",
    fontSize: 11,
  },
  txHash: { color: "rgba(255,255,255,0.8)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", textDecoration: "none" },
  txMeta: { marginLeft: "auto", color: "rgba(255,255,255,0.5)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", display: "flex", gap: 8 },
  emptyTxs: { color: "rgba(255,255,255,0.4)", fontSize: 11, padding: "4px 0" },
};

/**
 * 4.5 — Detail panel for the selected transaction type.
 * Shows min/avg/max gas price, avg gas used, total fee, tx count and a short
 * list of recent transactions for that type. Close → selectType(null).
 */
export function DetailPanel() {
  const selectedType = useGasStore((s) => s.selectedType);
  const metric = useGasStore((s) => (s.selectedType ? s.gasMetrics.get(s.selectedType) : undefined));
  const recentTxs = useGasStore((s) => s.recentTxs);
  const selectType = useGasStore((s) => s.selectType);

  const typeRecentTxs = useMemo(() => {
    if (!selectedType) return [];
    return recentTxs.filter((tx) => tx.txType === selectedType).slice(0, MAX_RECENT_IN_PANEL);
  }, [selectedType, recentTxs]);

  if (!selectedType || !metric) return null;

  const color = TX_COLORS[selectedType];
  // Guard samakan dengan GasTable (avgGasPrice > 0 && totalTxCount > 0):
  // totalTxCount > 0 tapi semua receipt tanpa harga (avgGasPrice 0) →
  // minGasPrice bisa Infinity, jangan render "Infinity Gwei".
  const hasData = metric.avgGasPrice > 0 && metric.totalTxCount > 0;
  const trendArrow = metric.trend === "up" ? "↗" : metric.trend === "down" ? "↘" : "→";

  return (
    <div style={styles.panel}>
      <style>{`@keyframes ghPanelIn { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
      <div style={styles.header}>
        <span style={{ ...styles.dot, background: color, boxShadow: `0 0 8px ${color}` }} />
        <span style={styles.title}>{TX_LABELS[selectedType]}</span>
        <span style={styles.trend} title="Trend">{trendArrow}</span>
        <button style={styles.close} onClick={() => selectType(null)} title="Close detail panel">
          ✕
        </button>
      </div>

      <div style={styles.body}>
        <div>
          <div style={styles.sectionTitle}>Gas Price (Gwei)</div>
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Min</div>
              <div style={styles.statValue}>{hasData ? formatGasPrice(metric.minGasPrice) : "—"}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Avg</div>
              <div style={styles.statValue}>{hasData ? formatGasPrice(metric.avgGasPrice) : "—"}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Max</div>
              <div style={styles.statValue}>{hasData ? formatGasPrice(metric.maxGasPrice) : "—"}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Avg Gas Used</div>
              <div style={styles.statValue}>{hasData ? formatNumber(metric.avgGasUsed) : "—"}</div>
            </div>
          </div>
        </div>

        <div>
          <div style={styles.sectionTitle}>Totals</div>
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total Fee (ETH)</div>
              <div style={styles.statValue}>{hasData ? formatEth(metric.totalFeeEth) : "—"}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Tx Count</div>
              <div style={styles.statValue}>{formatNumber(metric.totalTxCount)}</div>
            </div>
          </div>
        </div>

        <div>
          <div style={styles.sectionTitle}>Recent transactions</div>
          {typeRecentTxs.length === 0 ? (
            <div style={styles.emptyTxs}>No transactions for this type yet.</div>
          ) : (
            <div style={styles.txList}>
              {typeRecentTxs.map((tx) => {
                const feeEth = Number(tx.fee) / 1e18;
                return (
                  <div key={tx.hash} style={styles.txItem}>
                    <a href={`${EXPLORER}${tx.hash}`} target="_blank" rel="noreferrer" style={styles.txHash} title={tx.hash}>
                      {formatTxHash(tx.hash)}
                    </a>
                    <span style={styles.txMeta}>
                      <span>{formatNumber(Number(tx.gasUsed))}</span>
                      <span>{formatEth(feeEth)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DetailPanel;
