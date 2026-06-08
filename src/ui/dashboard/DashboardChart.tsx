import { DashboardTimePoint } from "../dashboard-types";
import { money } from "../api";

type Metric = "revenue" | "profit" | "costs" | "orders";
type GroupBy = "day" | "week" | "month";

const metricColors: Record<Metric, string> = {
  revenue: "#111",
  profit: "#059669",
  costs: "#dc2626",
  orders: "#f59e0b",
};

const metricLabels: Record<Metric, string> = {
  revenue: "Receita",
  profit: "Lucro",
  costs: "Custos",
  orders: "Pedidos",
};

export function DashboardChart({
  timeSeries,
  groupBy,
  metric,
  onGroupByChange,
  onMetricChange,
}: {
  timeSeries: DashboardTimePoint[];
  groupBy: GroupBy;
  metric: Metric;
  onGroupByChange: (g: GroupBy) => void;
  onMetricChange: (m: Metric) => void;
}) {
  if (!timeSeries.length) {
    return (
      <div className="panel">
        <div className="chart-header">
          <h2>Evolução por período</h2>
          <Controls groupBy={groupBy} metric={metric} onGroupByChange={onGroupByChange} onMetricChange={onMetricChange} />
        </div>
        <div className="chart-empty">Sem dados para o período selecionado.</div>
      </div>
    );
  }

  const width = 800;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 28, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const primaryValues = timeSeries.map(d => {
    if (metric === "profit") return d.profitCents;
    if (metric === "costs") return d.costsCents;
    if (metric === "orders") return d.orderCount * 10000;
    return d.revenueCents;
  });
  const allValues = timeSeries.flatMap(d => [d.revenueCents, d.profitCents, d.costsCents, d.orderCount * 10000]);
  const maxVal = Math.max(...allValues, 1);

  const x = (i: number) => pad.left + (timeSeries.length > 1 ? (i / (timeSeries.length - 1)) * innerW : innerW / 2);
  const y = (val: number) => pad.top + innerH - (val / maxVal) * innerH;

  const fmt = (val: number) => {
    const abs = Math.abs(val);
    if (abs >= 100000000) return `R$ ${(abs / 100000000).toFixed(1)}M`;
    if (abs >= 100000) return `R$ ${(abs / 1000).toFixed(0)}k`;
    if (abs >= 1000) return `R$ ${(abs / 100).toFixed(1)}k`;
    return String(abs);
  };

  const primaryPath = timeSeries.map((d, i) => {
    const val = primaryValues[i];
    return `${i === 0 ? "M" : "L"}${x(i)} ${y(val)}`;
  }).join(" ");

  const areaPath = `M${x(0)} ${y(0)} L${primaryPath.slice(1)} L${x(timeSeries.length - 1)} ${y(0)} Z`;

  const metricColor = metricColors[metric];
  const activeLabel = metricLabels[metric];

  const ticks = timeSeries.length > 10
    ? timeSeries.filter((_, i) => i % Math.ceil(timeSeries.length / 8) === 0 || i === timeSeries.length - 1)
    : timeSeries;

  return (
    <div className="panel">
      <div className="chart-header">
        <h2>Evolução por período</h2>
        <Controls groupBy={groupBy} metric={metric} onGroupByChange={onGroupByChange} onMetricChange={onMetricChange} />
      </div>
      <div className="chart-container">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="chart-svg">
          <defs>
            <linearGradient id="primaryGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={metricColor} stopOpacity="0.15" />
              <stop offset="100%" stopColor={metricColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="chart-grid">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const val = maxVal * t;
              return (
                <g key={t}>
                  <line x1={pad.left} x2={width - pad.right} y1={y(val)} y2={y(val)} stroke="#e8e8e8" strokeDasharray="3 3" />
                  <text x={pad.left - 6} y={y(val) + 3} textAnchor="end" fontSize="10" fill="#888">
                    {fmt(val)}
                  </text>
                </g>
              );
            })}
          </g>
          <path d={areaPath} fill="url(#primaryGrad)" />
          <path d={primaryPath} fill="none" stroke={metricColor} strokeWidth="2" strokeLinejoin="round" />
          {ticks.map((d, i) => {
            const idx = timeSeries.indexOf(d);
            const label = d.period.length > 7 ? d.period.slice(5) : d.period;
            return (
              <text key={d.period} x={x(idx)} y={height - 6} textAnchor="middle" fontSize="10" fill="#888">
                {label}
              </text>
            );
          })}
          <g fontSize="9">
            <line x1={width - 84} y1={12} x2={width - 68} y2={12} stroke={metricColor} strokeWidth="2" />
            <text x={width - 64} y={15} fill="#555">{activeLabel}</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

function Controls({ groupBy, metric, onGroupByChange, onMetricChange }: { groupBy: GroupBy; metric: Metric; onGroupByChange: (g: GroupBy) => void; onMetricChange: (m: Metric) => void }) {
  const groupOptions: { key: GroupBy; label: string }[] = [
    { key: "day", label: "Dia" },
    { key: "week", label: "Semana" },
    { key: "month", label: "Mês" },
  ];
  const metricOptions: { key: Metric; label: string }[] = [
    { key: "revenue", label: "Receita" },
    { key: "profit", label: "Lucro" },
    { key: "costs", label: "Custos" },
    { key: "orders", label: "Pedidos" },
  ];

  return (
    <div className="chart-controls-row">
      <div className="chart-controls">
        {groupOptions.map(o => (
          <button key={o.key} type="button" className={groupBy === o.key ? "active" : ""} onClick={() => onGroupByChange(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="chart-controls">
        {metricOptions.map(o => (
          <button key={o.key} type="button" className={metric === o.key ? "active" : ""} onClick={() => onMetricChange(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
