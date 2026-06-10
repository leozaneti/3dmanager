import { DashboardTimePoint } from "../dashboard-types";
import { money } from "../api";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend
} from "recharts";

type GroupBy = "day" | "week" | "month";

const METRICS = ["revenue", "profit", "costs", "orders"] as const;

const metricConfig: Record<string, { label: string; color: string }> = {
  revenue: { label: "Receita", color: "#111" },
  profit: { label: "Lucro", color: "#059669" },
  costs: { label: "Custos", color: "#dc2626" },
  orders: { label: "Pedidos", color: "#f59e0b" },
};

function formatPeriod(period: string, groupBy: GroupBy) {
  if (groupBy === "month") {
    const d = new Date(period + "-01T12:00:00");
    return d.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" });
  }
  if (groupBy === "week") {
    return period.length > 7 ? period.slice(5) : period;
  }
  const d = new Date(period + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

function fmtAxis(val: number) {
  const reais = Math.abs(val) / 100;
  if (reais >= 1_000_000) return `${(reais / 1_000_000).toFixed(1)}M`;
  if (reais >= 1_000) return `${(reais / 1_000).toFixed(0)}k`;
  return `${reais.toFixed(0)}`;
}

function fmtTooltip(val: number, name: string) {
  if (name === "orders") return [Math.round(val), "Pedidos"];
  return [money(val), metricConfig[name]?.label ?? name];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, padding: "10px 14px", fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: "#333" }}>{label}</div>
      {payload.map((entry: any) => (
        <div key={entry.name} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: "#555" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: entry.color, display: "inline-block" }} />
            {metricConfig[entry.name]?.label ?? entry.name}
          </span>
          <span style={{ fontWeight: 600, color: "#111" }}>{fmtTooltip(entry.value, entry.name)[0]}</span>
        </div>
      ))}
    </div>
  );
}

function renderLegend(props: any) {
  const { payload } = props;
  if (!payload) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 16, paddingTop: 8, fontSize: 12 }}>
      {payload.map((entry: any) => (
        <span key={entry.dataKey} style={{ display: "flex", alignItems: "center", gap: 4, color: "#555" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: entry.color, display: "inline-block" }} />
          {entry.value}
        </span>
      ))}
    </div>
  );
}

type Props = {
  timeSeries: DashboardTimePoint[];
  groupBy: GroupBy;
  activeMetrics: Record<string, boolean>;
  onMetricsChange: (m: Record<string, boolean>) => void;
  onGroupByChange: (g: GroupBy) => void;
};

export function DashboardChart({
  timeSeries,
  groupBy,
  activeMetrics,
  onMetricsChange,
  onGroupByChange,
}: Props) {
  if (!timeSeries.length) {
    return (
      <div className="panel">
        <div className="chart-header">
          <h2>Evolução por período</h2>
          <Controls groupBy={groupBy} activeMetrics={activeMetrics} onMetricsChange={onMetricsChange} onGroupByChange={onGroupByChange} />
        </div>
        <div className="chart-empty">Sem dados para o período selecionado.</div>
      </div>
    );
  }

  const hasAnyActive = Object.values(activeMetrics).some(Boolean);
  const hasMonetary = activeMetrics.revenue || activeMetrics.profit || activeMetrics.costs;
  const showRightAxis = activeMetrics.orders;

  return (
    <div className="panel">
      <div className="chart-header">
        <h2>Evolução por período</h2>
        <Controls groupBy={groupBy} activeMetrics={activeMetrics} onMetricsChange={onMetricsChange} onGroupByChange={onGroupByChange} />
      </div>
      {!hasAnyActive ? (
        <div className="chart-empty">Selecione ao menos uma métrica.</div>
      ) : (
        <div className="chart-container">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={timeSeries} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="period"
                tickFormatter={(p) => formatPeriod(p, groupBy)}
                tick={{ fontSize: 10, fill: "#888" }}
                tickLine={false}
                axisLine={{ stroke: "#e8e8e8" }}
                interval="preserveStartEnd"
              />
              {hasMonetary && (
                <YAxis
                  yAxisId="left"
                  tickFormatter={fmtAxis}
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
              )}
              {showRightAxis && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v: number) => Math.round(v).toString()}
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              <Legend content={renderLegend} />
              {activeMetrics.revenue && (
                <Line yAxisId="left" type="monotone" dataKey="revenueCents" name="revenue"
                  stroke={metricConfig.revenue.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              )}
              {activeMetrics.profit && (
                <Line yAxisId="left" type="monotone" dataKey="profitCents" name="profit"
                  stroke={metricConfig.profit.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              )}
              {activeMetrics.costs && (
                <Line yAxisId="left" type="monotone" dataKey="costsCents" name="costs"
                  stroke={metricConfig.costs.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              )}
              {activeMetrics.orders && (
                <Line yAxisId="right" type="monotone" dataKey="orderCount" name="orders"
                  stroke={metricConfig.orders.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Controls({
  groupBy, activeMetrics, onMetricsChange, onGroupByChange
}: {
  groupBy: GroupBy;
  activeMetrics: Record<string, boolean>;
  onMetricsChange: (m: Record<string, boolean>) => void;
  onGroupByChange: (g: GroupBy) => void;
}) {
  const groupOptions: { key: GroupBy; label: string }[] = [
    { key: "day", label: "Dia" },
    { key: "week", label: "Semana" },
    { key: "month", label: "Mês" },
  ];

  function toggle(key: string) {
    onMetricsChange({ ...activeMetrics, [key]: !activeMetrics[key] });
  }

  function setAll(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const k of METRICS) next[k] = value;
    onMetricsChange(next);
  }

  return (
    <div className="chart-controls-row">
      <div className="chart-controls">
        {groupOptions.map(o => (
          <button key={o.key} type="button" className={groupBy === o.key ? "active" : ""} onClick={() => onGroupByChange(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {METRICS.map(key => {
          const cfg = metricConfig[key];
          return (
            <label key={key} style={{
              display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer",
              padding: "3px 10px", borderRadius: 6,
              background: activeMetrics[key] ? cfg.color + "18" : "#f2f2f2",
              color: activeMetrics[key] ? cfg.color : "#555",
              fontWeight: activeMetrics[key] ? 600 : 400,
              border: `1px solid ${activeMetrics[key] ? cfg.color + "40" : "transparent"}`,
              transition: "all 0.15s",
            }}>
              <input type="checkbox" checked={!!activeMetrics[key]} onChange={() => toggle(key)}
                style={{ accentColor: cfg.color, margin: 0 }} />
              {cfg.label}
            </label>
          );
        })}
        <button type="button" onClick={() => setAll(true)}
          style={{ fontSize: 11, padding: "3px 8px", border: "1px solid #d4d4d4", borderRadius: 6, background: "#fafafa", cursor: "pointer", color: "#555" }}>
          Todas
        </button>
        <button type="button" onClick={() => setAll(false)}
          style={{ fontSize: 11, padding: "3px 8px", border: "1px solid #d4d4d4", borderRadius: 6, background: "#fafafa", cursor: "pointer", color: "#555" }}>
          Limpar
        </button>
      </div>
    </div>
  );
}
