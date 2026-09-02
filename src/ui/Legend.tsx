import { useState } from "react";
import { GAS_BRACKETS, TX_COLORS, TX_LABELS, TX_ORDER } from "./tx-theme";

const styles: Record<string, React.CSSProperties> = {
  card: {
    width: 230,
    background: "rgba(10, 10, 15, 0.72)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12,
    color: "#fff",
    fontSize: 11,
    overflow: "hidden",
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    cursor: "pointer",
    userSelect: "none" as const,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  title: { fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, fontSize: 10 },
  toggle: { color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1 },
  body: { padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 12 },
  gradient: { height: 10, borderRadius: 6, overflow: "hidden", display: "flex", width: "100%" },
  seg: { flex: 1 },
  bracketRow: { display: "flex", justifyContent: "space-between", marginTop: 3, color: "rgba(255,255,255,0.45)", fontSize: 9, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  typesTitle: { fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.45)" },
  dots: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" },
  dotRow: { display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" as const, overflow: "hidden" },
  dot: { width: 7, height: 7, borderRadius: 999, flexShrink: 0 },
  dotLabel: { color: "rgba(255,255,255,0.75)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis" },
};

/**
 * 4.4 — Legend: gas price gradient scale + per-type color dots. Collapsible.
 */
export function Legend() {
  const [open, setOpen] = useState(true);

  return (
    <div style={styles.card}>
      <div style={styles.header} onClick={() => setOpen((v) => !v)} title="Toggle legend">
        <span style={styles.title}>Legend</span>
        <span style={styles.toggle}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={styles.body}>
          <div>
            <div style={styles.gradient}>
              {GAS_BRACKETS.map((b) => (
                <div key={b.label} style={{ ...styles.seg, background: b.color }} title={b.label} />
              ))}
            </div>
            <div style={styles.bracketRow}>
              {GAS_BRACKETS.map((b) => (
                <span key={b.label}>{b.label}</span>
              ))}
            </div>
            <div style={{ marginTop: 4, color: "rgba(255,255,255,0.35)", fontSize: 9 }}>Gas price (Gwei)</div>
          </div>
          <div>
            <div style={styles.typesTitle}>Transaction types</div>
            <div style={styles.dots}>
              {TX_ORDER.map((t) => (
                <div key={t} style={styles.dotRow} title={TX_LABELS[t]}>
                  <span style={{ ...styles.dot, background: TX_COLORS[t] }} />
                  <span style={styles.dotLabel}>{TX_LABELS[t]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Legend;
