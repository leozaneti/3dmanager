import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, money } from "./api";
import { type Customer } from "./api";
import { CustomerDetailModal } from "./CustomerDetailModal";
import { OrderFinancialSidebar } from "./OrderFinancialSidebar";
import { ModalShell } from "./ModalShell";

type Props = {
  orderId: number | null;
  open: boolean;
  onClose: () => void;
  onEdit: (orderId: number) => void;
  onViewOrder?: (orderId: number) => void;
};

export function OrderDetailModal({ orderId, open, onClose, onEdit, onViewOrder }: Props) {
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const orderDetail = useQuery({
    queryKey: ["order-detail", orderId],
    queryFn: () => api<any>(`/orders/${orderId}`),
    enabled: open && orderId !== null
  });

  const order = open ? orderDetail.data : undefined;
  const items = order?.items ?? [];

  const productsTotal = useMemo(
    () => items.reduce((sum: number, item: any) => sum + item.quantity * item.saleUnitPriceCents, 0),
    [items]
  );
  const itemsCostTotal = useMemo(
    () => items.reduce((sum: number, item: any) => sum + item.quantity * item.costUnitCents, 0),
    [items]
  );

  if (!order) {
    return (
      <ModalShell open={open} onClose={onClose} title={`Pedido #${orderId}`}
        bodyStyle={{ padding: "40px", justifyContent: "center", color: "#999", fontSize: "14px" }}>
        Carregando detalhes do pedido...
    </ModalShell>
    );
  }

  function handleEdit() {
    onEdit(order.id);
    onClose();
  }

  return (
    <ModalShell open={open} onClose={onClose} title={`Pedido #${order.id}`}
      headerActions={<button type="button" className="btn-order btn-order-primary" onClick={handleEdit}>Editar Pedido</button>}>
      <div className="modal-order-main">
        {/* Card 1 - Order Info */}
        <div className="order-card">
          <div className="order-card-title">Informações do Pedido</div>
          <div className="detail-grid">
            <div className="detail-field">
              <label>Loja</label>
              <div className="detail-value">{order.storeName || "-"}</div>
            </div>
            <div className="detail-field">
              <label>Canal de Venda</label>
              <div className="detail-value">{order.salesChannelName || "-"}</div>
            </div>
            <div className="detail-field">
              <label>Cliente</label>
              <div className="detail-value">
                {order.customerId ? (
                  <button type="button" className="link-btn" onClick={() => setViewCustomer({ id: order.customerId, name: order.customerName })}>
                    {order.customerName}
                  </button>
                ) : order.customerName || "-"}
              </div>
            </div>
            <div className="detail-field">
              <label>Data</label>
              <div className="detail-value">{order.saleDate || "-"}</div>
            </div>
            <div className="detail-field">
              <label>Status</label>
              <div className="detail-value">{order.statusName || "-"}</div>
            </div>
            <div className="detail-field">
              <label>Pedido Externo</label>
              <div className="detail-value">{order.externalOrderId || "-"}</div>
            </div>
          </div>
          {order.notes && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 500, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Observações</div>
              <div style={{ fontSize: "13px", color: "#333", whiteSpace: "pre-wrap" }}>{order.notes}</div>
            </div>
          )}
        </div>

        {/* Card 2 - Items */}
        <div className="order-card" style={{ paddingBottom: "14px" }}>
          <div className="order-card-title">Itens do Pedido</div>
          <table className="items-table">
            <thead>
              <tr>
                <th style={{ width: "22%" }}>Produto</th>
                <th style={{ width: "10%" }}>SKU</th>
                <th style={{ width: "7%" }}>Qtd</th>
                <th style={{ width: "11%" }}>Venda Unit.</th>
                <th style={{ width: "11%" }}>Custo Unit.</th>
                <th style={{ width: "11%" }}>Total Venda</th>
                <th style={{ width: "11%" }}>Total Custo</th>
                <th style={{ width: "11%" }}>Lucro Item</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "#999", padding: "20px" }}>Nenhum item neste pedido.</td>
                </tr>
              )}
              {items.map((item: any, idx: number) => {
                const totalSale = item.quantity * item.saleUnitPriceCents;
                const totalCost = item.quantity * item.costUnitCents;
                const itemProfit = totalSale - totalCost;
                return (
                  <tr key={item.id ?? idx}>
                    <td>{item.listingTitle || "-"}</td>
                    <td style={{ color: "#888", fontSize: "12px" }}>{item.sku || "-"}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.saleUnitPriceCents)}</td>
                    <td>{money(item.costUnitCents)}</td>
                    <td>{money(totalSale)}</td>
                    <td>{money(totalCost)}</td>
                    <td style={{ color: itemProfit >= 0 ? "#059669" : "#dc2626", fontWeight: 500 }}>{money(itemProfit)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{ textAlign: "right", fontWeight: 500, fontSize: 12, color: "#999", padding: "10px 8px 0", borderTop: "1px solid #eee" }}>Totais</td>
                <td style={{ padding: "10px 8px 0", borderTop: "1px solid #eee", fontWeight: 600 }}>{money(productsTotal)}</td>
                <td style={{ padding: "10px 8px 0", borderTop: "1px solid #eee", fontWeight: 600 }}>{money(itemsCostTotal)}</td>
                <td style={{ padding: "10px 8px 0", borderTop: "1px solid #eee", fontWeight: 600, color: productsTotal - itemsCostTotal >= 0 ? "#059669" : "#dc2626" }}>{money(productsTotal - itemsCostTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

      </div>

      {/* RIGHT: Financial sidebar */}
      <OrderFinancialSidebar
        items={items}
        shippingTotalCents={order?.shippingTotalCents ?? 0}
        shippingCustomerCents={order?.shippingCustomerCents ?? 0}
        platformFeeCents={order?.platformFeeCents ?? 0}
        discountCents={order?.discountCents ?? 0}
        otherCostsCents={order?.otherCostsCents ?? 0}
        packagingCents={order?.packagingCents ?? 0}
        additionalCostsCents={order?.additionalCostsCents ?? 0}
      />
      {viewCustomer && (
        <CustomerDetailModal
          customer={viewCustomer}
          open
          onClose={() => setViewCustomer(null)}
          onEdit={(c) => { setViewCustomer(null); }}
          onViewOrder={(id) => { setViewCustomer(null); onViewOrder?.(id); }}
        />
      )}
    </ModalShell>
  );
}
