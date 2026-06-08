import { DashboardTotals } from "../dashboard-types";
import { money } from "../api";

export function DashboardDaily({ totals, previous, days: periodDays }: { totals: DashboardTotals; previous?: DashboardTotals | null; days?: number }) {
  const days = periodDays ?? 1;
  const dailyRevenue = totals.grossRevenueCents / days;
  const dailyProfit = totals.profitCents / days;

  const prevDays = previous && previous.orderCount > 0
    ? days // use same period length for comparison
    : 0;

  const prevDailyRevenue = prevDays > 0 && previous ? previous.grossRevenueCents / prevDays : null;
  const prevDailyProfit = prevDays > 0 && previous ? previous.profitCents / prevDays : null;

  function compareText(current: number, prev: number | null): { text: string; dir: "up" | "down" } | null {
    if (prev == null || prev === 0) return null;
    const diff = ((current - prev) / prev) * 100;
    return { text: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%`, dir: diff >= 0 ? "up" : "down" };
  }

  const revComp = compareText(dailyRevenue, prevDailyRevenue);
  const profitComp = compareText(dailyProfit, prevDailyProfit);

  return (
    <div className="kpi-row kpi-row-dash-2">
      <div className="kpi-card">
        <span className="kpi-label">Receita diária média</span>
        <span className="kpi-value">{money(dailyRevenue)}<small style={{ fontSize: 13, fontWeight: 400, color: "#888", marginLeft: 2 }}>/dia</small></span>
        {revComp && (
          <span className={`kpi-compare ${revComp.dir}`}>
            {revComp.dir === "up" ? "▲" : "▼"} {revComp.text} <span className="sub">vs período anterior</span>
          </span>
        )}
      </div>
      <div className="kpi-card">
        <span className="kpi-label">Lucro diário médio</span>
        <span className="kpi-value">{money(dailyProfit)}<small style={{ fontSize: 13, fontWeight: 400, color: "#888", marginLeft: 2 }}>/dia</small></span>
        {profitComp && (
          <span className={`kpi-compare ${profitComp.dir}`}>
            {profitComp.dir === "up" ? "▲" : "▼"} {profitComp.text} <span className="sub">vs período anterior</span>
          </span>
        )}
      </div>
    </div>
  );
}
