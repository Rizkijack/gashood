import { useMemo, useState } from "react";
import { TxType } from "@/data/tx-classifier";
import { useGasStore } from "@/store/gas-store";
import { formatEth, formatGasPrice, formatNumber } from "@/utils/format";
import { TX_COLORS, TX_LABELS, TX_ORDER } from "./tx-theme";

type SortKey = "type" | "avgGas" | "avgPrice" | "txCount" | "fee";
type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "type", label: "Type" },
  { key: "avgGas", label: "Avg Gas" },
  { key: "avgPrice", label: "Avg Price" },
  { key: "txCount", label: "Tx Count" },
  { key: "fee", label: "Total Fee" },
];

const styles: Record<string, React.CSSProperties> = {
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
    color: "#fff",
    textAlign: "left" as const,
  },
  th: {
    padding: "6px 8px",
    fontSize: 9,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "rgba(255,255,255,0.5)",
    background: "rgba(255,255,255,0.04)",
    borderBottom: "1px solid rgba(255,255,255,0.12)",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    userSelect: "none" as const,
  },
  td: { padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  typeCell: { display: "flex", alignItems: "center", gap: 7, fontFamily: "Inter, system-ui, sans-serif", fontWeight: 600 },
  dot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  sortHint: { opacity: 0.6, marginLeft: 4, fontSize: 9 },
};

function rowBackground(selected: boolean, hovered: boolean, color: string): string {
  if (selected) return `rgba(255,255,255,0.10)`;
  if (hovered) return `${color}22`;
  return "transparent";
}

/**
 * 4.2 — Sortable gas fee table (12 tx types).
 * Row hover  → store.hoverType (glow building in 3D).
 * Row click  → store.selectType (camera focus + detail panel).
 * Subscribes to store.hoveredType so hovering a 3D building highlights the row.
 */
export function GasTable() {
  const gasMetrics = useGasStore((s) => s.gasMetrics);
  const selectedType = useGasStore((s) => s.selectedType);
  const hoveredType = useGasStore((s) => s.hoveredType);
  const selectType = useGasStore((s) => s.selectType);
  const hoverType = useGasStore((s) => s.hoverType);

  const [sort, setSort] = useState<SortState>({ key: "txCount", dir: "desc" });

  const rows = useMemo(() => {
    const list = TX_ORDER.map((t) => gasMetrics.get(t)).filter(
      (m): m is NonNullable<typeof m> => m !== undefined,
    );
    const idx = (t: TxType) => TX_ORDER.indexOf(t);
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "type":
          cmp = idx(a.txType) - idx(b.txType);
          break;
        case "avgGas":
          cmp = a.avgGasUsed - b.avgGasUsed;
          break;
        case "avgPrice":
          cmp = a.avgGasPrice - b.avgGasPrice;
          break;
        case "txCount":
          cmp = a.totalTxCount - b.totalTxCount;
          break;
        case "fee":
          cmp = a.totalFeeEth - b.totalFeeEth;
          break;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [gasMetrics, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  const arrow = (key: SortKey): string =>
    sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : "";

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          {COLUMNS.map((c) => (
            <th
              key={c.key}
              style={styles.th}
              onClick={() => toggleSort(c.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSort(c.key);
                }
              }}
              role="button"
              tabIndex={0}
              aria-sort={
                sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
              }
              title={`Sort by ${c.label}`}
            >
              {c.label}
              <span style={styles.sortHint}>{arrow(c.key)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const color = TX_COLORS[m.txType];
          const selected = selectedType === m.txType;
          const hovered = hoveredType === m.txType;
          const hasData = m.avgGasPrice > 0 && m.totalTxCount > 0;
          return (
            <tr
              key={m.txType}
              onClick={() => selectType(m.txType)}
              onMouseEnter={() => hoverType(m.txType)}
              onMouseLeave={() => hoverType(null)}
              style={{
                background: rowBackground(selected, hovered, color),
                borderLeft: selected ? `3px solid ${color}` : "3px solid transparent",
                cursor: "pointer",
                transition: "background 0.15s ease",
              }}
            >
              <td style={styles.td}>
                <span style={styles.typeCell}>
                  <span style={{ ...styles.dot, background: color, boxShadow: hovered || selected ? `0 0 6px ${color}` : "none" }} />
                  {TX_LABELS[m.txType]}
                </span>
              </td>
              <td style={styles.td}>{hasData ? formatNumber(m.avgGasUsed) : "—"}</td>
              <td style={styles.td}>{hasData ? formatGasPrice(m.avgGasPrice) : "—"}</td>
              <td style={styles.td}>{formatNumber(m.totalTxCount)}</td>
              <td style={styles.td}>{hasData ? formatEth(m.totalFeeEth) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default GasTable;
