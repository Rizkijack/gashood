import { useGasStore } from "@/store/gas-store";
import { formatBlockNumber, formatEth, formatGasPrice, formatNumber, formatUsd } from "@/utils/format";
import { ethToUsd } from "@/utils/gas-math";

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 16px",
    background: "rgba(10, 10, 15, 0.72)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    color: "#fff",
    zIndex: 20,
    pointerEvents: "none",
    flexWrap: "wrap",
  },
  brand: { display: "flex", alignItems: "center", gap: 10 },
  brandIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "linear-gradient(135deg,#00FF88 0%,#00CCFF 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
  },
  brandTitle: { fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 },
  brandSub: {
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  status: { display: "flex", alignItems: "center", gap: 8 },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    display: "inline-block",
    flexShrink: 0,
  },
  stats: { display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" },
  statItem: {},
  statLabel: { fontSize: 9, color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em", textTransform: "uppercase" as const },
  statValue: { fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 600, color: "#fff" },
  statSub: { fontSize: 9, color: "rgba(255,255,255,0.45)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", marginTop: 1 },
};

/**
 * 4.1 — Top dashboard bar with live network stats.
 * Read-only overlay (pointerEvents none) so the 3D canvas stays interactive.
 */
export function Dashboard() {
  const networkStats = useGasStore((s) => s.networkStats);
  const isCollecting = useGasStore((s) => s.isCollecting);
  const gasMetrics = useGasStore((s) => s.gasMetrics);
  // Selector granular (primitive) — harga USD berubah jarang (throttle 60s).
  const ethUsdPrice = useGasStore((s) => s.networkStats.ethUsdPrice);

  // Avg fee across all observed txs: sum(fee) / sum(count)
  let totalFee = 0;
  let totalCount = 0;
  gasMetrics.forEach((m) => {
    totalFee += m.totalFeeEth;
    totalCount += m.totalTxCount;
  });
  const avgFee = totalCount > 0 ? totalFee / totalCount : 0;

  const hasData = networkStats.totalTransactions > 0;
  // "" (non-finite guard di formatUsd) → skip render, jangan tampil "≈ " kosong.
  const avgFeeUsd = ethUsdPrice !== null && hasData ? formatUsd(ethToUsd(avgFee, ethUsdPrice)) : "";

  return (
    <div style={styles.bar}>
      <div style={styles.brand}>
        <div style={styles.brandIcon}>⛽</div>
        <div>
          <div style={styles.brandTitle}>GasHood</div>
          <div style={styles.brandSub}>Robinhood Chain · 3D Gas Tracker</div>
        </div>
      </div>

      <div style={styles.stats}>
        <div style={styles.status}>
          <span
            style={{
              ...styles.statusDot,
              background: isCollecting ? "#00FF88" : "#FFAA00",
              boxShadow: isCollecting ? "0 0 8px #00FF88" : "none",
            }}
          />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
            {isCollecting ? "Collecting" : "Idle"}
          </span>
        </div>

        <div style={styles.statItem}>
          <div style={styles.statLabel}>Gas Price</div>
          <div style={styles.statValue}>
            {hasData ? formatGasPrice(networkStats.currentGasPrice) : "—"}
          </div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>TPS</div>
          <div style={styles.statValue}>{hasData ? networkStats.tps.toFixed(1) : "—"}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>Block</div>
          <div style={styles.statValue}>
            {networkStats.lastBlockNumber > 0 ? formatBlockNumber(networkStats.lastBlockNumber) : "—"}
          </div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>Avg Fee</div>
          <div style={styles.statValue}>{hasData ? formatEth(avgFee) : "—"}</div>
          {avgFeeUsd !== "" && <div style={styles.statSub}>≈ {avgFeeUsd}</div>}
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>Total Tx</div>
          <div style={styles.statValue}>{formatNumber(networkStats.totalTransactions)}</div>
        </div>
        {ethUsdPrice !== null && (
          <div style={styles.statItem}>
            <div style={styles.statLabel}>ETH Price</div>
            <div style={styles.statValue}>{formatUsd(ethUsdPrice)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
