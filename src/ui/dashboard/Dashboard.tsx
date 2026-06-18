import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, money, Meta } from "../api";
import { DashboardData, DashboardTimePoint } from "../dashboard-types";
import { DashboardKpiRow } from "./DashboardKpiRow";
import { DashboardDaily } from "./DashboardDaily";
import { DashboardCompBar } from "./DashboardCompBar";
import { DashboardChart } from "./DashboardChart";
import { DashboardChannels } from "./DashboardChannels";
import { PageHeader } from "../PageHeader";
import { DatePresetBar, type DatePreset } from "../DatePresetBar";
import { dateRangeFor } from "../../hooks/useDatePresets";

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

  function setPreset(preset: DatePreset) {
    const { startDate, endDate, allTime } = dateRangeFor(preset);
    setStartDate(startDate);
    setEndDate(endDate);
    setAllTime(allTime);
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
      <PageHeader title="Dashboard" subtitle="Resultados por período com comparativo" />

      <div className="toolbar">
        <DatePresetBar
          activePreset={startDate === todayStr && endDate === todayStr ? "today" : undefined}
          isAllTime={allTime}
          onPresetChange={setPreset}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={(v) => { setStartDate(v); setAllTime(false); }}
          onEndDateChange={(v) => { setEndDate(v); setAllTime(false); }}
        />
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

      {data && <>
          {(() => {
            const ts = data.timeSeries;
            const dailyDays = allTime && ts.length > 1
              ? Math.max(1, Math.round((new Date(ts[ts.length - 1].period).getTime() - new Date(ts[0].period).getTime()) / 86400000) + 1)
              : allTime ? ts.length
              : Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1);
            return <DashboardDaily totals={data.totals} previous={data.previousTotals} days={dailyDays} />;
          })()}
          <DashboardKpiRow totals={data.totals} previous={data.previousTotals} type="financial" />

          <div className="panel">
            <h2>Composição da Receita <span className="subtitle">Custos × Taxas × Lucro</span></h2>
            <DashboardCompBar totals={data.totals} />
          </div>

          <DashboardKpiRow totals={data.totals} previous={data.previousTotals} type="operational" />

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
      }
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
