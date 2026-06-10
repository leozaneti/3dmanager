import { DashboardChannel } from "../dashboard-types";
import { money } from "../api";
import { PieChart, Pie, Cell, Tooltip } from "recharts";

type ViewMode = "revenue" | "orders" | "margin";

const COLORS = ["#059669", "#6366f1", "#f59e0b", "#8b5cf6"];

function formatValue(val: number, view: ViewMode) {
  if (view === "orders") return Math.round(val).toString();
  if (view === "margin") return val.toFixed(1) + "%";
  return money(val);
}

function CustomTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
      <div style={{ color: "#555" }}>{formatValue(d.value, d._view)}</div>
    </div>
  );
}

export function DashboardChannels({ channels, view }: { channels: DashboardChannel[]; view: ViewMode }) {
  const total = channels.reduce((s, c) => s + (view === "orders" ? c.orderCount : view === "margin" ? 1 : c.grossRevenueCents), 0);
  const avgMargin = channels.length ? channels.reduce((s, c) => s + c.marginPercent, 0) / channels.length : 0;

  const data = view === "margin"
    ? channels.map(c => ({ name: c.name, value: c.marginPercent, _view: view, marginPercent: c.marginPercent }))
    : channels.map(c => ({
      name: c.name,
      value: view === "orders" ? c.orderCount : c.grossRevenueCents,
      _view: view,
      marginPercent: c.marginPercent,
    }));

  const centerText = view === "orders"
    ? `${total}`
    : view === "margin"
      ? `${avgMargin.toFixed(1)}%`
      : money(total);
  const centerLabel = view === "orders" ? "Total pedidos" : view === "margin" ? "Margem média" : "Receita total";

  return (
    <div className="channel-body">
      <div style={{ position: "relative", width: 180, height: 180, flexShrink: 0 }}>
        <PieChart width={180} height={180}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx={90} cy={90} innerRadius={54} outerRadius={82}
            startAngle={90} endAngle={-270}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i] ?? "#888"} />
            ))}
          </Pie>
          <Tooltip content={<CustomTip />} />
        </PieChart>
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -60%)",
          textAlign: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111", lineHeight: 1.2 }}>{centerText}</div>
          <div style={{ fontSize: 11, color: "#888" }}>{centerLabel}</div>
        </div>
      </div>
      <div className="channel-side">
        <div className="channel-bar-list">
          {channels.map((c, i) => {
            const share = total > 0
              ? view === "orders" ? (c.orderCount / total) * 100 : (c.grossRevenueCents / total) * 100
              : 0;
            return (
              <div key={c.name} className="ch-row">
                <span className="ch-dot" style={{ background: COLORS[i] ?? "#888" }}></span>
                <span className="ch-name">{c.name}</span>
                <span className="ch-bar-wrap"><span className="ch-bar" style={{ width: share + "%" }}></span></span>
                <span className="ch-val">{share.toFixed(0)}%</span>
                <span className="ch-sub">{c.marginPercent.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
        <div className="ch-footer">
          <span className="ch-dot-label">Participação</span>
          <span className="ch-sub-label">Margem</span>
        </div>
      </div>
    </div>
  );
}
