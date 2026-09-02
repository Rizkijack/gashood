import { useEffect, useRef } from "react";
import type { ClassifiedTransaction } from "@/data/tx-classifier";
import { useGasStore } from "@/store/gas-store";
import { formatEth, formatNumber, formatTxHash } from "@/utils/format";
import { TX_COLORS, TX_LABELS } from "./tx-theme";

const MAX_RENDER = 50;
const EXPLORER = "https://robinhoodchain.blockscout.com/tx/";

const styles: Record<string, React.CSSProperties> = {
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "4px 8px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 8px",
    borderRadius: 6,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.05)",
    fontSize: 11,
    transition: "background 0.12s ease",
  },
  hash: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    textDecoration: "none",
    flexShrink: 0,
  },
  badge: {
    flexShrink: 0,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    padding: "2px 6px",
    borderRadius: 999,
    border: "1px solid",
    whiteSpace: "nowrap" as const,
  },
  meta: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    color: "rgba(255,255,255,0.55)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    flexShrink: 0,
  },
  empty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    padding: 16,
    textAlign: "center" as const,
  },
};

function TxItem({ tx }: { tx: ClassifiedTransaction }) {
  const color = TX_COLORS[tx.txType];
  const feeEth = Number(tx.fee) / 1e18;
  return (
    <div style={styles.item}>
      <a
        href={`${EXPLORER}${tx.hash}`}
        target="_blank"
        rel="noreferrer"
        style={styles.hash}
        title={tx.hash}
      >
        {formatTxHash(tx.hash)}
      </a>
      <span style={{ ...styles.badge, color, borderColor: `${color}55`, background: `${color}18` }}>
        {TX_LABELS[tx.txType]}
      </span>
      <span style={styles.meta}>
        <span title="Gas used">{formatNumber(Number(tx.gasUsed))}</span>
        <span title="Fee">{formatEth(feeEth)}</span>
      </span>
    </div>
  );
}

/**
 * 4.3 — Scrollable live transaction feed.
 * New data prepends at the top; auto-scrolls back to top on new transactions.
 */
export function TxFeed() {
  const recentTxs = useGasStore((s) => s.recentTxs);
  const listRef = useRef<HTMLDivElement>(null);
  const firstHash = recentTxs.length > 0 ? recentTxs[0].hash : undefined;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [firstHash]);

  const visible = recentTxs.slice(0, MAX_RENDER);

  if (visible.length === 0) {
    return <div style={styles.empty}>Waiting for new blocks...</div>;
  }

  return (
    <div style={styles.list} ref={listRef}>
      {visible.map((tx) => (
        <TxItem key={tx.hash} tx={tx} />
      ))}
    </div>
  );
}

export default TxFeed;
