import { DashboardTotals } from "../dashboard-types";
import { money } from "../api";

export function DashboardCompBar({ totals }: { totals: DashboardTotals }) {
  const grossRevenue = totals.grossRevenueCents;
  const saleResult = totals.saleResultCents;
  const netRevenue = totals.netRevenueCents;
  const itemsCost = totals.itemsCostCents;
  const profit = totals.profitCents;
  const productionCost = itemsCost + (saleResult - netRevenue);
  const feesAndFreightCost = grossRevenue - saleResult;

  const denominator = grossRevenue || 1;
  const custosPct = (productionCost / denominator) * 100;
  const taxasPct = (feesAndFreightCost / denominator) * 100;
  const lucroPct = (profit / denominator) * 100;

  return (
    <div className="comp-bar-wrap">
      <div className="stacked-bar">
        <div className="stacked-seg seg-red" style={{ width: custosPct + "%" }}>{money(productionCost)} ({custosPct.toFixed(1)}%)</div>
        <div className="stacked-seg seg-amber" style={{ width: taxasPct + "%" }}>{money(feesAndFreightCost)} ({taxasPct.toFixed(1)}%)</div>
        <div className="stacked-seg seg-green" style={{ width: lucroPct + "%" }}>{money(profit)} ({lucroPct.toFixed(1)}%)</div>
      </div>
      <div className="comp-legend">
        <div className="item"><span className="dot" style={{ background: "#ef4444" }}></span> Custo de Produção <span className="pct">{custosPct.toFixed(1)}%</span></div>
        <div className="item"><span className="dot" style={{ background: "#f59e0b" }}></span> Taxas + Frete <span className="pct">{taxasPct.toFixed(1)}%</span></div>
        <div className="item"><span className="dot" style={{ background: "#10b981" }}></span> Lucro <span className="pct">{lucroPct.toFixed(1)}%</span></div>
      </div>
    </div>
  );
}
