import { useState } from "react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Customer, money } from "./api";
import { ModalShell } from "./ModalShell";
import { Pagination } from "./Pagination";

const HISTORY_PAGE_SIZE = 50;

type Props = {
  customer: Customer;
  open: boolean;
  onClose: () => void;
  onEdit: (customer: Customer) => void;
  onViewOrder: (orderId: number) => void;
};

export function CustomerDetailModal({ customer, open, onClose, onEdit, onViewOrder }: Props) {
  const [historyPage, setHistoryPage] = useState(0);

  const summary = useQuery({
    queryKey: ["customer-summary", customer.id],
    queryFn: () =>
      api<{
        totalOrders: number;
        totalRevenueCents: number;
        totalProfitCents: number;
        firstPurchase: string | null;
        lastPurchase: string | null;
      }>(`/customers/${customer.id}/summary`),
    enabled: open
  });

  const ordersQuery = useQuery({
    queryKey: ["orders", { customerId: customer.id, page: historyPage }],
    queryFn: () =>
      api<{
        data: any[];
        total: number;
        filterTotals: any;
        activeOrderCount: number;
      }>(`/orders?customerId=${customer.id}&limit=${HISTORY_PAGE_SIZE}&offset=${historyPage * HISTORY_PAGE_SIZE}`),
    enabled: open
  });

  const data = summary.data;
  const ordersData = ordersQuery.data;
  const kpis = useMemo(() => {
    if (!data) return null;
    return {
      grossRevenueCents: data.totalRevenueCents,
      profitCents: data.totalProfitCents,
    };
  }, [data]);

  return (
    <ModalShell open={open} onClose={onClose} title={customer.name}
      headerExtra={customer.document && <span style={{ fontSize: "13px", color: "#888" }}>{customer.document}</span>}
      headerActions={<button type="button" className="btn-order btn-order-primary" onClick={() => onEdit(customer)}>Editar Cliente</button>}
      maxWidth="80vw">
          {/* Main content */}
          <div className="modal-order-main">
            {/* Card 1 - Informações Principais */}
            <div className="order-card">
              <div className="order-card-title">Informações Principais</div>
              <div className="detail-grid">
                <div className="detail-field">
                  <label>Nome</label>
                  <div className="detail-value">{customer.name}</div>
                </div>
                <div className="detail-field">
                  <label>CPF/CNPJ</label>
                  <div className="detail-value">{customer.document || "-"}</div>
                </div>
                <div className="detail-field">
                  <label>Telefone</label>
                  <div className="detail-value">{customer.phone || "-"}</div>
                </div>
                <div className="detail-field">
                  <label>E-mail</label>
                  <div className="detail-value">{customer.email || "-"}</div>
                </div>
              </div>
            </div>

            {/* Card 2 - Endereço */}
            <div className="order-card">
              <div className="order-card-title">Endereço</div>
              <div className="detail-grid">
                <div className="detail-field">
                  <label>CEP</label>
                  <div className="detail-value">{customer.cep || "-"}</div>
                </div>
                <div className="detail-field">
                  <label>Logradouro</label>
                  <div className="detail-value">{customer.logradouro || "-"}</div>
                </div>
                <div className="detail-field">
                  <label>Número</label>
                  <div className="detail-value">{customer.numero || "-"}</div>
                </div>
                <div className="detail-field">
                  <label>Complemento</label>
                  <div className="detail-value">{customer.complemento || "-"}</div>
                </div>
                <div className="detail-field">
                  <label>Bairro</label>
                  <div className="detail-value">{customer.bairro || "-"}</div>
                </div>
                <div className="detail-field">
                  <label>Cidade</label>
                  <div className="detail-value">{customer.cidade || "-"}</div>
                </div>
                <div className="detail-field">
                  <label>Estado</label>
                  <div className="detail-value">{customer.estado || "-"}</div>
                </div>
              </div>
            </div>

            {/* Card 3 - Observações (only if content) */}
            {customer.notes && (
              <div className="order-card">
                <div className="order-card-title">Observações</div>
                <div className="detail-value" style={{ whiteSpace: "pre-wrap", fontSize: "13px", color: "#333" }}>
                  {customer.notes}
                </div>
              </div>
            )}

            {/* Card 4 - Histórico de Pedidos */}
            <div className="order-card">
              <div className="order-card-title">Histórico de Pedidos</div>
              {ordersData ? (
                <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Pedido ext.</th>
                        <th>Data</th>
                        <th>Canal</th>
                        <th>Status</th>
                        <th>Receita</th>
                        <th>Resultado Venda</th>
                        <th>Lucro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersData.data.length === 0 && (
                        <tr>
                          <td colSpan={8}>Nenhum pedido encontrado para este cliente.</td>
                        </tr>
                      )}
                      {ordersData.data.map((order: any) => (
                        <tr key={order.id}>
                          <td>
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => onViewOrder(order.id)}
                            >
                              #{order.id}
                            </button>
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {order.externalOrderId ? (
                              <button type="button" className="link-btn" onClick={() => onViewOrder(order.id)}>
                                {order.externalOrderId}
                              </button>
                            ) : "-"}
                          </td>
                          <td>{order.saleDate}</td>
                          <td>{order.salesChannelName}</td>
                          <td><span className={`status-badge status-${order.statusName?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`}>{order.statusName}</span></td>
                          <td>{money(order.totals.grossRevenueCents)}</td>
                          <td>{money(order.totals.saleResultCents)}</td>
                          <td>{money(order.totals.profitCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={historyPage}
                  pageSize={HISTORY_PAGE_SIZE}
                  total={ordersData.total}
                  onPageChange={setHistoryPage}
                  itemLabel="pedidos"
                />
                </>
              ) : (
                <div style={{ padding: "20px 0", color: "#999", fontSize: "13px" }}>Carregando histórico...</div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="modal-order-sidebar">
            <div className="sidebar-section">
              <div className="sidebar-label">Resumo do Cliente</div>
              {data ? (
                <>
                  <div className="sidebar-row">
                    <span>Pedidos</span>
                    <strong>{data.totalOrders}</strong>
                  </div>
                  <div className="sidebar-divider" />
                  <div className="sidebar-row">
                    <span>Receita Total</span>
                    <strong>{money(kpis?.grossRevenueCents ?? 0)}</strong>
                  </div>
                  <div className="sidebar-row">
                    <span>Lucro Total</span>
                    <strong>{money(kpis?.profitCents ?? 0)}</strong>
                  </div>
                  <div className="sidebar-divider" />
                  <div className="sidebar-row">
                    <span>Primeira compra</span>
                    <strong style={{ fontWeight: 500, fontSize: "12px" }}>{data.firstPurchase || "-"}</strong>
                  </div>
                  <div className="sidebar-row">
                    <span>Última compra</span>
                    <strong style={{ fontWeight: 400, fontSize: "12px" }}>{data.lastPurchase || "-"}</strong>
                  </div>
                </>
              ) : (
                <div style={{ padding: "20px 0", color: "#999", fontSize: "12px" }}>Carregando...</div>
              )}
            </div>
          </div>
    </ModalShell>
  );
}
