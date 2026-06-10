import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, money, Meta } from "../api";
import { DashboardData, DashboardTimePoint } from "../dashboard-types";
import { DashboardKpiRow } from "./DashboardKpiRow";
import { DashboardDaily } from "./DashboardDaily";
import { DashboardCompBar } from "./DashboardCompBar";
import { DashboardChart } from "./DashboardChart";
import { DashboardChannels } from "./DashboardChannels";

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p className="page-header-subtitle">{subtitle}</p>
      </div>
    </div>
  );
}

export function Dashboard({ meta }: { meta: Meta }) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

  const [storeId, setStoreId] = useState("");
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(todayStr);
  const [allTime, setAllTime] = useState(false);
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("day");
  const [activeMetrics, setActiveMetrics] = useState<Record<string, boolean>>({
    revenue: true, profit: true, costs: false, orders: false
  });
  const [channelView, setChannelView] = useState<"revenue" | "orders" | "margin">("revenue");

  function setPreset(preset: string) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    switch (preset) {
      case "today":
        setStartDate(todayStr);
        setEndDate(todayStr);
        setAllTime(false);
        break;
      case "yesterday": {
        const yest = new Date(now);
        yest.setDate(d - 1);
        const s = yest.toISOString().slice(0, 10);
        setStartDate(s);
        setEndDate(s);
        setAllTime(false);
        break;
      }
      case "7d": {
        const dt = new Date(now);
        dt.setDate(d - 7);
        setStartDate(dt.toISOString().slice(0, 10));
        setEndDate(todayStr);
        setAllTime(false);
        break;
      }
      case "15d": {
        const dt = new Date(now);
        dt.setDate(d - 15);
        setStartDate(dt.toISOString().slice(0, 10));
        setEndDate(todayStr);
        setAllTime(false);
        break;
      }
      case "30d": {
        const dt = new Date(now);
        dt.setDate(d - 30);
        setStartDate(dt.toISOString().slice(0, 10));
        setEndDate(todayStr);
        setAllTime(false);
        break;
      }
      case "month":
        setStartDate(firstOfMonth);
        setEndDate(todayStr);
        setAllTime(false);
        break;
      case "lastmonth": {
        const lastMonthStart = new Date(y, m - 1, 1);
        const lastMonthEnd = new Date(y, m, 0);
        setStartDate(lastMonthStart.toISOString().slice(0, 10));
        setEndDate(lastMonthEnd.toISOString().slice(0, 10));
        setAllTime(false);
        break;
      }
      case "all": {
        setStartDate("");
        setEndDate("");
        setAllTime(true);
        break;
      }
    }
  }

  const params = new URLSearchParams();
  if (storeId) params.set("storeId", storeId);
  if (allTime) {
    params.set("allTime", "true");
  } else {
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
  }
  params.set("groupBy", groupBy);
  const qs = params.toString();

  const dashboard = useQuery({
    queryKey: ["dashboard", qs],
    queryFn: () => api<DashboardData>(`/dashboard${qs ? `?${qs}` : ""}`),
  });

  const data = dashboard.data;

  return (
    <>
      <Header title="Dashboard" subtitle="Resultados por período com comparativo" />

      <div className="toolbar">
        <div className="date-filter">
          <button type="button" className={startDate === todayStr && endDate === todayStr ? "active" : ""} onClick={() => setPreset("today")}>Hoje</button>
          <button type="button" onClick={() => setPreset("yesterday")}>Ontem</button>
          <button type="button" onClick={() => setPreset("7d")}>7D</button>
          <button type="button" onClick={() => setPreset("15d")}>15D</button>
          <button type="button" onClick={() => setPreset("30d")}>30D</button>
          <button type="button" onClick={() => setPreset("month")}>Este mês</button>
          <button type="button" onClick={() => setPreset("lastmonth")}>Mês passado</button>
          <button type="button" onClick={() => setPreset("all")}>Todo período</button>
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setAllTime(false); }} />
          <span style={{ color: "#888" }}>até</span>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setAllTime(false); }} />
        </div>
        <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          <option value="">Todas as lojas</option>
          {meta.stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>

      {dashboard.isLoading && <div className="kpi-loading">Carregando dados...</div>}

      {data && (
        <>
          <DashboardKpiRow totals={data.totals} previous={data.previousTotals} type="financial" />

          <div className="panel">
            <h2>Composição da Receita <span className="subtitle">Custos × Taxas × Lucro</span></h2>
            <DashboardCompBar totals={data.totals} />
          </div>

          <DashboardKpiRow totals={data.totals} previous={data.previousTotals} type="operational" />

          <DashboardDaily totals={data.totals} previous={data.previousTotals} days={allTime ? data.timeSeries.length : Math.max(Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1, 1)} />

          <DashboardChart
            timeSeries={data.timeSeries}
            groupBy={groupBy}
            activeMetrics={activeMetrics}
            onMetricsChange={setActiveMetrics}
            onGroupByChange={setGroupBy}
          />

          <div className="columns">
            <div className="panel">
              <div className="chart-header">
                <h2>Canais de Venda</h2>
                <div className="chart-controls">
                  <button type="button" className={channelView === "revenue" ? "active" : ""} onClick={() => setChannelView("revenue")}>Receita</button>
                  <button type="button" className={channelView === "orders" ? "active" : ""} onClick={() => setChannelView("orders")}>Pedidos</button>
                  <button type="button" className={channelView === "margin" ? "active" : ""} onClick={() => setChannelView("margin")}>Margem</button>
                </div>
              </div>
              <DashboardChannels channels={data.channels} view={channelView} />
            </div>

            <div className="panel">
              <h2>Produtos mais vendidos</h2>
              <SimpleTable rows={data.products ?? []} columns={["name", "quantity", "revenueCents", "profitCents", "marginPercent"]} />
            </div>
          </div>

          <div className="panel">
            <h2>Lojas</h2>
            <SimpleTable rows={(data.stores ?? []).map(s => ({ ...s, marginPercent: s.grossRevenueCents ? (s.profitCents / s.grossRevenueCents) * 100 : 0 }))} columns={["name", "grossRevenueCents", "profitCents", "marginPercent"]} />
          </div>
        </>
      )}
    </>
  );
}

function SimpleTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  const labels: Record<string, string> = {
    name: "Nome",
    quantity: "Qtd.",
    revenueCents: "Receita",
    profitCents: "Lucro",
    orderCount: "Pedidos",
    grossRevenueCents: "Receita",
    marginPercent: "Margem",
  };
  return (
    <div className="table-wrap">
      <table className="sortable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{labels[column] ?? column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length}>Sem dados ainda.</td>
            </tr>
          )}
          {rows.map((row: any, index: number) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} className={column.endsWith("Cents") || column === "quantity" || column === "marginPercent" ? "num" : ""}>
                  {column.endsWith("Cents") ? money(row[column]) : column === "marginPercent" ? `${(row[column] ?? 0).toFixed(1)}%` : row[column]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
