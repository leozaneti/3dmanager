import { DashboardChannel } from "../dashboard-types";
import { money } from "../api";

type ViewMode = "revenue" | "orders" | "margin";

export function DashboardChannels({ channels, view }: { channels: DashboardChannel[]; view: ViewMode }) {
  const total = channels.reduce((s, c) => s + (view === "orders" ? c.orderCount : view === "margin" ? 1 : c.grossRevenueCents), 0);
  const avgMargin = channels.length ? channels.reduce((s, c) => s + c.marginPercent, 0) / channels.length : 0;
  const circumference = 2 * Math.PI * 72;

  let arcs: { color: string; dash: string; offset: number }[] = [];
  if (view === "margin") {
    const sorted = [...channels].sort((a, b) => b.marginPercent - a.marginPercent);
    const maxMargin = Math.max(...sorted.map(c => c.marginPercent), 1);
    let offset = 0;
    arcs = sorted.map((c, i) => {
      const pct = c.marginPercent / maxMargin;
      const colors = ["#059669", "#6366f1", "#f59e0b", "#8b5cf6"];
      const seg = { color: colors[i] || "#888", dash: `${pct * circumference} ${circumference * (1 - pct)}`, offset };
      offset += pct * circumference;
      return seg;
    });
  } else {
    let accumulated = 0;
    arcs = channels.map((c, i) => {
      const pct = total > 0 ? (view === "orders" ? c.orderCount / total : c.grossRevenueCents / total) : 0;
      const colors = ["#059669", "#6366f1", "#f59e0b", "#8b5cf6"];
      const seg = { color: colors[i] || "#888", dash: `${pct * circumference} ${circumference * (1 - pct)}`, offset: accumulated };
      accumulated += pct * circumference;
      return seg;
    });
  }

  const centerText = view === "orders"
    ? `${total}`
    : view === "margin"
      ? `${avgMargin.toFixed(1)}%`
      : money(total);
  const centerLabel = view === "orders" ? "Total pedidos" : view === "margin" ? "Margem média" : "Receita total";

  return (
    <div className="channel-body">
      <svg className="channel-donut" width={180} height={180} viewBox="0 0 180 180">
        <circle cx={90} cy={90} r={72} fill="none" stroke="#f0f0f0" strokeWidth={28} />
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={90} cy={90} r={72}
            fill="none"
            stroke={arc.color}
            strokeWidth={28}
            strokeDasharray={arc.dash}
            transform={`rotate(${(arc.offset / circumference) * 360 - 90} 90 90)`}
          />
        ))}
        <circle cx={90} cy={90} r={54} fill="#fff" />
        <text x={90} y={84} textAnchor="middle" fontSize={22} fontWeight={700} fill="#111">{centerText}</text>
        <text x={90} y={104} textAnchor="middle" fontSize={11} fill="#888">{centerLabel}</text>
      </svg>
      <div className="channel-side">
        <div className="channel-bar-list">
          {channels.map((c, i) => {
            const share = total > 0
              ? view === "orders" ? (c.orderCount / total) * 100 : (c.grossRevenueCents / total) * 100
              : 0;
            const colors = ["#059669", "#6366f1", "#f59e0b", "#8b5cf6"];
            return (
              <div key={c.name} className="ch-row">
                <span className="ch-dot" style={{ background: colors[i] || "#888" }}></span>
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
