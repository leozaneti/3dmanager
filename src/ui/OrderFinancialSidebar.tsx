import { useMemo } from "react";
import { money } from "./api";

type SidebarItem = {
  listingTitle?: string;
  sku?: string;
  quantity: number;
  saleUnitPriceCents: number;
  costUnitCents: number;
};

type Props = {
  items: SidebarItem[];
  shippingTotalCents: number;
  shippingCustomerCents: number;
  platformFeeCents: number;
  discountCents: number;
  otherCostsCents: number;
  packagingCents: number;
  additionalCostsCents: number;
};

export function OrderFinancialSidebar({
  items,
  shippingTotalCents,
  shippingCustomerCents,
  platformFeeCents,
  discountCents,
  otherCostsCents,
  packagingCents,
  additionalCostsCents,
}: Props) {
  const productsTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.saleUnitPriceCents, 0),
    [items]
  );
  const itemsCostTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.costUnitCents, 0),
    [items]
  );

  const totalFeesDeduction = platformFeeCents + shippingTotalCents - shippingCustomerCents - discountCents;
  const netReceived = productsTotal + shippingCustomerCents - shippingTotalCents - platformFeeCents - otherCostsCents + discountCents;
  const productionCost = itemsCostTotal + packagingCents + additionalCostsCents;
  const profit = netReceived - productionCost;
  const marginPercent = (productsTotal + shippingCustomerCents) > 0 ? (profit / (productsTotal + shippingCustomerCents)) * 100 : 0;

  const stage1Value = productsTotal - otherCostsCents;
  const showCompBar = stage1Value > 0 && profit >= 0;
  const pPct = showCompBar ? (profit / stage1Value) * 100 : 0;
  const fPct = showCompBar ? (totalFeesDeduction / stage1Value) * 100 : 0;
  const cPct = showCompBar ? (productionCost / stage1Value) * 100 : 0;

  return (
    <div className="modal-order-sidebar">
      {/* Stage 1 - Receita da Venda */}
      <div className="financial-stage">
        <div className="stage-header">
          <span className="stage-number">1</span>
          <span className="stage-title">Receita da Venda</span>
        </div>
        <div className="stage-value">{money(stage1Value)}</div>
        <div className="stage-bar">
          <div className="stage-bar-fill stage-bar-green" style={{ width: "100%" }} />
        </div>
        <div className="stage-breakdown">
          {items.map((item, i) => (
            <div key={i} className="breakdown-row">
              <span>{item.listingTitle || item.sku || `Item ${i + 1}`} ({item.quantity}x {money(item.quantity * item.saleUnitPriceCents)})</span>
              <span>{money(item.quantity * item.saleUnitPriceCents)}</span>
            </div>
          ))}
          {otherCostsCents > 0 && (
            <div className="breakdown-row">
              <span>Cupom</span>
              <span className="negative">{money(-otherCostsCents)}</span>
            </div>
          )}
          <div className="breakdown-divider" />
          <div className="breakdown-row">
            <span style={{ fontWeight: 500, color: "#444" }}>Total Produtos</span>
            <span style={{ fontWeight: 600 }}>{money(stage1Value)}</span>
          </div>
        </div>
      </div>

      {/* Stage 2 - Taxas e Frete */}
      <div className="financial-stage">
        <div className="stage-header">
          <span className="stage-number">2</span>
          <span className="stage-title">Taxas e Frete</span>
        </div>
        <div className="stage-value">{money(totalFeesDeduction)}</div>
        <div className="stage-bar">
          <div className="stage-bar-fill stage-bar-amber"
               style={{ width: `${productsTotal ? Math.min((totalFeesDeduction / productsTotal) * 100, 100) : 0}%` }} />
        </div>
        <div className="stage-breakdown">
          <div className="breakdown-row">
            <span>Tarifa ML</span>
            <span className="negative">{money(-platformFeeCents)}</span>
          </div>
          {discountCents !== 0 && (
            <div className="breakdown-row">
              <span>Desconto na taxa</span>
              <span className="positive">{money(discountCents)}</span>
            </div>
          )}
          <div className="breakdown-divider" />
          <div className="breakdown-section-title">Frete</div>
          <div className="breakdown-row">
            <span>Recebido Cliente</span>
            <span className="positive">{money(shippingCustomerCents)}</span>
          </div>
          <div className="breakdown-row">
            <span>Custo ML</span>
            <span className="negative">{money(-shippingTotalCents)}</span>
          </div>
          <div className="breakdown-row breakdown-highlight">
            <span className="breakdown-label">Custo Líquido Frete</span>
            <span className="breakdown-value" style={shippingCustomerCents - shippingTotalCents >= 0 ? { color: "#059669", fontWeight: 700 } : { color: "#dc2626", fontWeight: 700 }}>{money(shippingCustomerCents - shippingTotalCents)}</span>
          </div>
          <div className="breakdown-divider" />
          <div className="breakdown-row">
            <span style={{ fontWeight: 500, color: "#444" }}>Total Taxas e Frete</span>
            <span className="negative" style={{ fontWeight: 600 }}>{money(-totalFeesDeduction)}</span>
          </div>
        </div>
      </div>

      {/* Card: Resultado da Venda */}
      <div className="result-card result-card-sale">
        <div className="result-label">Resultado da Venda</div>
        <div className="result-value">{money(netReceived)}</div>
        <div className="result-percent">{productsTotal ? ((netReceived / productsTotal) * 100).toFixed(1) : 0}% da receita</div>
      </div>

      {/* Stage 3 - Custos de Produção */}
      <div className="financial-stage">
        <div className="stage-header">
          <span className="stage-number">3</span>
          <span className="stage-title">Custos de Produção</span>
        </div>
        <div className="stage-value">{money(productionCost)}</div>
        <div className="stage-bar">
          <div className="stage-bar-fill stage-bar-red"
               style={{ width: `${productsTotal ? (productionCost / productsTotal) * 100 : 0}%` }} />
        </div>
        <div className="stage-breakdown">
          <div className="breakdown-row">
            <span>Produto</span>
            <span className="negative">{money(-itemsCostTotal)}</span>
          </div>
          <div className="breakdown-row">
            <span>Embalagem</span>
            <span className="negative">{money(-packagingCents)}</span>
          </div>
          <div className="breakdown-row">
            <span>Custos Adicionais</span>
            <span className="negative">{money(-additionalCostsCents)}</span>
          </div>
          <div className="breakdown-divider" />
          <div className="breakdown-row">
            <span style={{ fontWeight: 500, color: "#444" }}>Total Custos Produção</span>
            <span className="negative" style={{ fontWeight: 600 }}>{money(-productionCost)}</span>
          </div>
        </div>
      </div>

      {/* Card: Lucro Líquido */}
      <div className={`result-card result-card-final ${profit >= 0 ? "result-card-positive" : "result-card-negative"}`}>
        <div className="result-label">Lucro Líquido</div>
        <div className="result-value">{money(profit)}</div>
      </div>

      {/* Composição (barra empilhada) */}
      {showCompBar && (
        <div className="comp-bar-wrap">
          <div className="stacked-bar">
            <div className="stacked-seg seg-green" style={{ width: pPct + "%" }}>{money(profit)}</div>
            <div className="stacked-seg seg-amber" style={{ width: fPct + "%" }}>{money(totalFeesDeduction)}</div>
            <div className="stacked-seg seg-red" style={{ width: cPct + "%" }}>{money(productionCost)}</div>
          </div>
          <div className="comp-legend">
            <div className="item"><span className="dot" style={{ background: "#10b981" }}></span> Lucro <span className="pct">{pPct.toFixed(1)}%</span></div>
            <div className="item"><span className="dot" style={{ background: "#f59e0b" }}></span> Taxas+Frete <span className="pct">{fPct.toFixed(1)}%</span></div>
            <div className="item"><span className="dot" style={{ background: "#ef4444" }}></span> Custo Prod. <span className="pct">{cPct.toFixed(1)}%</span></div>
          </div>
        </div>
      )}

      {/* Margem Final */}
      <div className="margin-card">
        <div className="margin-card-label">Margem Final</div>
        <div className={`margin-card-pct ${profit >= 0 ? "positive" : "negative"}`}>{marginPercent.toFixed(1)}%</div>
      </div>
    </div>
  );
}
