import { DashboardTotals } from "../dashboard-types";
import { money } from "../api";

function pctChange(current: number, previous?: number | null): { pct: number | null; dir: "up" | "down" | null } {
  if (!previous) return { pct: null, dir: null };
  if (previous === 0) return { pct: current > 0 ? 100 : 0, dir: current >= 0 ? "up" : "down" };
  const diff = ((current - previous) / previous) * 100;
  return { pct: Math.abs(diff), dir: diff >= 0 ? "up" : "down" };
}

function absChange(current: number, previous?: number | null): { abs: number; dir: "up" | "down" | null } {
  if (previous == null) return { abs: 0, dir: null };
  const diff = current - previous;
  return { abs: Math.abs(diff), dir: diff >= 0 ? "up" : "down" };
}

function compareText(current: number, previous?: number | null, fmt: "pct" | "abs" | "pp" = "pct"): { text: string; dir: "up" | "down" | null } {
  if (previous == null) return { text: "", dir: null };
  if (fmt === "abs") {
    const c = absChange(current, previous);
    return { text: `${c.dir === "up" ? "+" : "-"}${c.abs}`, dir: c.dir };
  }
  if (fmt === "pp") {
    const diff = current - previous;
    const dir = diff >= 0 ? "up" : "down";
    return { text: `${dir === "up" ? "+" : ""}${diff.toFixed(1)} pp`, dir };
  }
  const c = pctChange(current, previous);
  if (c.pct == null) return { text: "", dir: null };
  return { text: `${c.dir === "up" ? "+" : "-"}${c.pct.toFixed(1)}%`, dir: c.dir };
}

function Compare({ current, previous, fmt, className }: { current: number; previous?: number | null; fmt?: "pct" | "abs" | "pp"; className?: string }) {
  const c = compareText(current, previous, fmt);
  if (!c.dir) return null;
  return (
    <span className={`kpi-compare ${c.dir} ${className ?? ""}`}>
      {c.dir === "up" ? "▲" : "▼"} {c.text} <span className="sub">vs período anterior</span>
    </span>
  );
}

export function DashboardKpiRow({ totals, previous, type }: { totals: DashboardTotals; previous?: DashboardTotals | null; type: "financial" | "operational" }) {
  if (type === "financial") {
    return (
      <div className="kpi-row kpi-row-dash">
        <div className="kpi-card">
          <span className="kpi-label">Receita Bruta</span>
          <span className="kpi-value">{money(totals.grossRevenueCents)}</span>
          <Compare current={totals.grossRevenueCents} previous={previous?.grossRevenueCents} />
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Resultado da Venda <span className="tip" title="Receita Bruta − Taxas − Frete − Cupons">ⓘ</span></span>
          <span className="kpi-value">{money(totals.saleResultCents)}</span>
          <Compare current={totals.saleResultCents} previous={previous?.saleResultCents} />
        </div>
        <div className={`kpi-hero${totals.profitCents < 0 ? " negative" : ""}`}>
          <span className="kpi-label">Lucro Líquido</span>
          <span className="kpi-value kpi-hero-value">{money(totals.profitCents)}</span>
          <span className="kpi-compare">
            {(() => {
              const c = compareText(totals.profitCents, previous?.profitCents);
              return c.dir ? `${c.dir === "up" ? "▲" : "▼"} ${c.text}  ·  Margem: ${totals.marginPercent.toFixed(1)}%` : `Margem: ${totals.marginPercent.toFixed(1)}%`;
            })()}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Margem</span>
          <span className="kpi-value">{totals.marginPercent.toFixed(1)}%</span>
          <Compare current={totals.marginPercent} previous={previous?.marginPercent} fmt="pp" />
        </div>
      </div>
    );
  }

  const avgTicket = totals.avgTicketCents;
  const itemsPerOrder = totals.orderCount ? totals.totalItems / totals.orderCount : 0;
  const profitPerOrder = totals.orderCount ? totals.profitCents / totals.orderCount : 0;

  const prevAvgTicket = previous?.avgTicketCents;
  const prevItemsPerOrder = previous?.orderCount ? previous.totalItems / previous.orderCount : 0;
  const prevProfitPerOrder = previous?.orderCount ? previous.profitCents / previous.orderCount : 0;

  return (
    <div className="kpi-row kpi-row-dash">
      <div className="kpi-card">
        <span className="kpi-label">Pedidos</span>
        <span className="kpi-value">{totals.orderCount}</span>
        <Compare current={totals.orderCount} previous={previous?.orderCount} fmt="abs" />
      </div>
      <div className="kpi-card">
        <span className="kpi-label">Ticket Médio</span>
        <span className="kpi-value">{money(avgTicket)}</span>
        <Compare current={avgTicket} previous={prevAvgTicket} />
      </div>
      <div className="kpi-card alert">
        <span className="kpi-label">Itens / Pedido</span>
        <span className="kpi-value">{itemsPerOrder.toFixed(1)}</span>
        <Compare current={itemsPerOrder} previous={prevItemsPerOrder} />
      </div>
      <div className="kpi-card">
        <span className="kpi-label">Lucro por Pedido</span>
        <span className="kpi-value">{money(profitPerOrder)}</span>
        <Compare current={profitPerOrder} previous={prevProfitPerOrder} />
      </div>
    </div>
  );
}
