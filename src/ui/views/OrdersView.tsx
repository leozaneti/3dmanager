import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { api, money, fmtDate, Customer, OrdersResponse, Paginated, Product } from "../api";
import { calculateKpisFromTotals } from "../finance";
import { PageHeader } from "../PageHeader";
import { Panel } from "../Panel";
import { Pagination } from "../Pagination";
import { Notification } from "../Notification";
import { OrderDetailModal } from "../OrderDetailModal";
import { OrderModal } from "../OrderModal";
import { CustomerDetailModal } from "../CustomerDetailModal";
import { ConfirmDeleteModal } from "../ConfirmDeleteModal";
import { KpiCard, KpiHero } from "../KpiCard";
import { DatePresetBar, type DatePreset } from "../DatePresetBar";
import { dateRangeFor } from "../../hooks/useDatePresets";
import { useDeleteMutation } from "../../hooks/useDeleteMutation";
import { useSelection } from "../../hooks/useSelection";
import { useSort } from "../../hooks/useSort";
import type { Meta } from "../api";

type TooltipState = {
  x: number; y: number;
  order?: any;
  type?: "revenue" | "result" | "profit";
  rows?: { label: string; value: string; cls?: string }[];
} | null;

export function OrdersView({ meta, pendingOrderId, onConsumePendingOrder }: { meta: Meta; pendingOrderId?: number | null; onConsumePendingOrder?: () => void }) {
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: ["products-all"], queryFn: () => api<Paginated<Product>>("/products") });
  const customers = useQuery({ queryKey: ["customers-all"], queryFn: () => api<Paginated<Customer>>("/customers") });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const pageSize = 20;
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (filterStatus) params.set("statusId", filterStatus);
  if (filterFrom) params.set("from", filterFrom);
  if (filterTo) params.set("to", filterTo);
  if (filterStore) params.set("storeId", filterStore);
  if (filterChannel) params.set("channelId", filterChannel);
  params.set("limit", String(pageSize));
  params.set("offset", String(page * pageSize));
  const qs = params.toString();
  const orders = useQuery({
    queryKey: ["orders", search, filterStatus, filterFrom, filterTo, filterStore, filterChannel, page],
    queryFn: () => api<OrdersResponse>(`/orders${qs ? `?${qs}` : ""}`)
  });
  const [orderBulkDeleteConfirm, setOrderBulkDeleteConfirm] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const orderDetails = useQuery({
    queryKey: ["order", editingOrderId],
    queryFn: () => api<any>(`/orders/${editingOrderId}`),
    enabled: editingOrderId !== null
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, statusId }: { id: number; statusId: number }) =>
      api(`/orders/${id}/status`, { method: "PUT", body: JSON.stringify({ statusId }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      setMessage(`Erro ao alterar status: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
    }
  });

  const statusTransitions = useQuery<Record<number, { id: number; name: string }[]>>({
    queryKey: ["status-transitions"],
    queryFn: () => api("/status-transitions"),
    staleTime: 60 * 60 * 1000,
  });

  const deleteMutation = useDeleteMutation({
    endpoint: "/orders",
    queryKeysToInvalidate: [["orders"], ["dashboard"]],
    onSuccess: () => {
      setMessage("Pedido excluído com sucesso.");
      setDeleteTarget(null);
    },
    onError: (err) => {
      setMessage(`Erro ao excluir pedido: ${err.message}`);
    }
  });

  const orderBulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api("/orders/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setMessage("Pedidos excluídos com sucesso.");
      oSel.clear();
      setOrderBulkDeleteConfirm(false);
    },
    onError: (err) => {
      setMessage(`Erro ao excluir pedidos: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
      setOrderBulkDeleteConfirm(false);
    }
  });

  useEffect(() => {
    if (pendingOrderId) {
      setDetailOrderId(pendingOrderId);
      onConsumePendingOrder?.();
    }
  }, [pendingOrderId]);

  function openCreateModal() {
    setEditingOrderId(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingOrderId(null);
  }

  function handleEdit(orderId: number) {
    setEditingOrderId(orderId);
    setModalOpen(true);
  }

  function handleViewOrder(orderId: number) {
    setDetailOrderId(orderId);
  }

  function closeDetailModal() {
    setDetailOrderId(null);
  }

  function handleDeleteOrder(id: number) {
    setDeleteTarget(id);
  }

  const rawOrderList = orders.data?.data ?? [];
  const orderList = rawOrderList.map((o) => ({
    ...o,
    saleResultPct: o.totals?.grossRevenueCents ? ((o.totals?.saleResultCents ?? 0) / o.totals.grossRevenueCents) : 0,
    marginPct: o.totals?.grossRevenueCents ? ((o.totals?.profitCents ?? 0) / o.totals.grossRevenueCents) : 0,
    deliverySort: o.deliveredDate || o.deliveryForecastDate || "",
  }));
  const oSel = useSelection(orderList);

  const kpis = useMemo(() => {
    const ft = orders.data?.filterTotals;
    const activeOrderCount = orders.data?.activeOrderCount ?? 0;
    if (!ft || ft.orderCount === 0) {
      return {
        displayed: orderList.length,
        total: orders.data?.total ?? 0,
        allTotal: orders.data?.total ?? 0,
        grossRevenueCents: 0, saleResultCents: 0, profitCents: 0,
        avgTicketCents: 0, marginPercent: 0,
        sumProducts: 0, sumShipCustomer: 0, sumShipTotal: 0,
        sumFees: 0, sumOther: 0, sumDiscount: 0,
        sumItemsCost: 0, sumPackaging: 0, sumAdditional: 0, sumSaleResult: 0,
      };
    }
    const { grossRevenueCents, saleResultCents, profitCents, marginPercent } = calculateKpisFromTotals(ft);
    return {
      displayed: orderList.length,
      total: orders.data?.total ?? 0,
      allTotal: orders.data?.total ?? 0,
      grossRevenueCents,
      saleResultCents,
      profitCents,
      avgTicketCents: activeOrderCount ? Math.round(grossRevenueCents / activeOrderCount) : 0,
      marginPercent,
      sumProducts: ft.productsAmountCents,
      sumShipCustomer: ft.shippingCustomerCents,
      sumShipTotal: ft.shippingTotalCents,
      sumFees: ft.platformFeeCents,
      sumOther: ft.otherCostsCents,
      sumDiscount: ft.discountCents,
      sumItemsCost: ft.itemsCostCents,
      sumPackaging: ft.packagingCents,
      sumAdditional: ft.additionalCostsCents,
      sumSaleResult: saleResultCents,
    };
  }, [orderList, orders.data]);

  const { sorted: sortedOrders, sortBy: sOrdBy, sortDir: sOrdDir, handleSort: sOrdSort } = useSort(orderList, "id");

  function setDatePreset(preset: DatePreset) {
    const { startDate, endDate } = dateRangeFor(preset);
    setFilterFrom(startDate);
    setFilterTo(endDate);
    setPage(0);
  }

  return (
    <>
      <PageHeader title="Pedidos" />

      <section className="kpi-section">
        <div className="kpi-row">
          <KpiCard label="Pedidos" value={kpis.total}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const rows = (orders.data?.statusCounts ?? []).map((s: any) => ({
                label: s.name, value: s.count,
                cls: s.name === "Devolvido" ? "muted" as const : undefined,
              }));
              setTooltip({ x: rect.right - 8, y: rect.bottom + 6, rows });
            }}
            onMouseLeave={() => setTooltip(null)} />
          <KpiCard label="Receita" value={money(kpis.grossRevenueCents)}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setTooltip({ x: rect.right - 8, y: rect.bottom + 6, rows: [{ label: "Produtos", value: money(kpis.sumProducts) }, { label: "Frete Cliente", value: money(kpis.sumShipCustomer) }] });
            }}
            onMouseLeave={() => setTooltip(null)} />
          <KpiCard label="Resultado Venda" value={money(kpis.saleResultCents)} sub={`${kpis.grossRevenueCents ? ((kpis.saleResultCents / kpis.grossRevenueCents) * 100).toFixed(1) : 0}% da receita`}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const netFreight = kpis.sumShipCustomer - kpis.sumShipTotal;
              setTooltip({ x: rect.right - 8, y: rect.bottom + 6, rows: [
                { label: "Frete Líq.", value: money(netFreight >= 0 ? netFreight : -netFreight), cls: netFreight >= 0 ? "positive" : "negative" },
                { label: "Taxa", value: money(-kpis.sumFees), cls: "negative" },
                ...(kpis.sumOther > 0 ? [{ label: "Cupom", value: money(-kpis.sumOther), cls: "negative" as const }] : []),
                { label: "Desconto", value: money(kpis.sumDiscount), cls: kpis.sumDiscount > 0 ? "positive" : "" },
              ]});
            }}
            onMouseLeave={() => setTooltip(null)} />
          <KpiHero label="Lucro Líquido" value={money(kpis.profitCents)} margin={kpis.marginPercent}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setTooltip({ x: rect.right - 8, y: rect.bottom + 6, rows: [
                { label: "Resultado Venda", value: money(kpis.sumSaleResult) },
                ...(kpis.sumItemsCost > 0 ? [{ label: "Custo Produto", value: money(-kpis.sumItemsCost), cls: "negative" as const }] : []),
                ...(kpis.sumPackaging > 0 ? [{ label: "Embalagem", value: money(-kpis.sumPackaging), cls: "negative" as const }] : []),
                ...(kpis.sumAdditional > 0 ? [{ label: "Custos Adicionais", value: money(-kpis.sumAdditional), cls: "negative" as const }] : []),
              ]});
            }}
            onMouseLeave={() => setTooltip(null)} />
          <KpiCard label="Ticket Médio" value={money(kpis.avgTicketCents)}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setTooltip({ x: rect.right - 8, y: rect.bottom + 6, rows: [
                { label: "Média por pedido", value: money(kpis.avgTicketCents) },
                { label: "Pedidos considerados", value: String(orders.data?.activeOrderCount ?? 0) },
                { label: "", value: "Pedidos devolvidos não entram", cls: "muted" as const },
              ]});
            }}
            onMouseLeave={() => setTooltip(null)} />
        </div>
      </section>

      <div className="toolbar">
        <DatePresetBar
          presets={[
            { key: "today", label: "Hoje" },
            { key: "7d", label: "7D" },
            { key: "30d", label: "30D" },
            { key: "month", label: "Mês" },
            { key: "lastmonth", label: "Mês passado" },
            { key: "all", label: "Todo período", isAllTime: true },
          ]}
          onPresetChange={setDatePreset}
          startDate={filterFrom}
          endDate={filterTo}
          onStartDateChange={(v) => { setFilterFrom(v); setPage(0); }}
          onEndDateChange={(v) => { setFilterTo(v); setPage(0); }}
        />
        <select value={filterStore} onChange={(e) => { setFilterStore(e.target.value); setPage(0); }} style={{ maxWidth: 140 }}>
          <option value="">Todas lojas</option>
          {meta.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterChannel} onChange={(e) => { setFilterChannel(e.target.value); setPage(0); }} style={{ maxWidth: 140 }}>
          <option value="">Todos canais</option>
          {meta.channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }} style={{ maxWidth: 130 }}>
          <option value="">Todos status</option>
          {meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          type="search"
          placeholder="Buscar por #ID, pedido externo, cliente, SKU, notas..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          style={{ flex: 1, maxWidth: 240 }}
        />
        <button type="button" onClick={openCreateModal}>Adicionar novo</button>
      </div>

      <Notification message={message} onClose={() => setMessage("")} />

      {oSel.count > 0 && (
        <div className="bulk-bar">
          <span><strong>{oSel.count}</strong> pedido(s) selecionado(s)</span>
          <button className="bulk-delete-btn" onClick={() => setOrderBulkDeleteConfirm(true)}>
            Excluir selecionados
          </button>
        </div>
      )}

      <Panel title={`Pedidos registrados ${kpis.allTotal > 0 ? `(${kpis.displayed} de ${kpis.allTotal})` : ""}`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="col-checkbox">
                  <input type="checkbox" checked={oSel.allSelected} onChange={oSel.toggleAll} />
                </th>
                <th className={`sortable ${sOrdBy === "id" ? sOrdDir : ""}`} onClick={() => sOrdSort("id")}>#</th>
                <th className={`sortable ${sOrdBy === "externalOrderId" ? sOrdDir : ""}`} onClick={() => sOrdSort("externalOrderId")}>Pedido ext.</th>
                <th className={`sortable ${sOrdBy === "saleDate" ? sOrdDir : ""}`} onClick={() => sOrdSort("saleDate")}>Data</th>
                <th className={`sortable ${sOrdBy === "storeName" ? sOrdDir : ""}`} onClick={() => sOrdSort("storeName")}>Loja</th>
                <th className={`sortable ${sOrdBy === "salesChannelName" ? sOrdDir : ""}`} onClick={() => sOrdSort("salesChannelName")}>Canal</th>
                <th className={`sortable ${sOrdBy === "customerName" ? sOrdDir : ""}`} onClick={() => sOrdSort("customerName")}>Cliente</th>
                <th className={`sortable ${sOrdBy === "statusName" ? sOrdDir : ""}`} onClick={() => sOrdSort("statusName")}>Status</th>
                <th className={`sortable ${sOrdBy === "deliverySort" ? sOrdDir : ""}`} onClick={() => sOrdSort("deliverySort")} style={{ fontSize: 11 }}>Entrega</th>
                <th>Produtos</th>
                <th className={`sortable ${sOrdBy === "totals.grossRevenueCents" ? sOrdDir : ""}`} onClick={() => sOrdSort("totals.grossRevenueCents")}>Receita</th>
                <th className={`sortable ${sOrdBy === "totals.saleResultCents" ? sOrdDir : ""}`} onClick={() => sOrdSort("totals.saleResultCents")}>Resultado Venda</th>
                <th className={`sortable ${sOrdBy === "saleResultPct" ? sOrdDir : ""}`} onClick={() => sOrdSort("saleResultPct")} style={{ fontSize: 12 }}>% Receita</th>
                <th className={`sortable ${sOrdBy === "totals.profitCents" ? sOrdDir : ""}`} onClick={() => sOrdSort("totals.profitCents")}>Lucro Líquido</th>
                <th className={`sortable ${sOrdBy === "marginPct" ? sOrdDir : ""}`} onClick={() => sOrdSort("marginPct")} style={{ fontSize: 12 }}>Margem Líq.</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedOrders.map((order) => {
                const saleResult = order.totals?.saleResultCents ?? 0;
                const profit = order.totals?.profitCents ?? 0;
                return (
                <tr key={order.id} className="table-row-hover">
                  <td className="col-checkbox">
                    <input type="checkbox" checked={oSel.selected.has(order.id)} onChange={() => oSel.toggleOne(order.id)} />
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    <button type="button" className="link-btn" onClick={() => handleViewOrder(order.id)}>
                      {order.id}
                    </button>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {order.externalOrderId ? (
                      <button type="button" className="link-btn" onClick={() => handleViewOrder(order.id)}>
                        {order.externalOrderId}
                      </button>
                    ) : "-"}
                  </td>
                  <td>{fmtDate(order.saleDate)}</td>
                  <td>{order.storeName}</td>
                  <td>{order.salesChannelName}</td>
                  <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", fontSize: 13 }}>
                    {order.customerId ? (
                      <button type="button" className="link-btn" onClick={() => {
                        const c = (customers.data?.data ?? []).find((c: Customer) => c.id === order.customerId);
                        if (c) setViewCustomer(c);
                      }}>{order.customerName}</button>
                    ) : order.customerName || "-"}
                  </td>
                  <td>
                    {statusTransitions.data?.[order.statusId]?.length ? (
                      <select
                        className={`status-badge status-${(order.statusName || "").toLowerCase()}`}
                        value={order.statusId}
                        onChange={(e) => statusMutation.mutate({ id: order.id, statusId: Number(e.target.value) })}
                      >
                        <option value={order.statusId} disabled>{order.statusName}</option>
                        {statusTransitions.data[order.statusId].map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`status-badge status-${(order.statusName || "").toLowerCase()}`}>{order.statusName}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, whiteSpace: "nowrap", color: "#6b7280" }}>
                    {order.deliveryForecastDate && !order.deliveredDate
                      ? `📅 ${order.deliveryForecastDate.slice(8,10)}/${order.deliveryForecastDate.slice(5,7)}`
                      : order.deliveredDate
                      ? `✅ ${order.deliveredDate.slice(8,10)}/${order.deliveredDate.slice(5,7)}`
                      : "—"}
                  </td>
                  <td style={{ maxWidth: 220, fontSize: 12 }}>
                    {order.items ? (
                      <div className="order-items-mini">
                        {String(order.items).split(", ").filter(Boolean).map((sku: string, i: number) => (
                          <span key={i} className="order-sku-tag">{sku}</span>
                        ))}
                      </div>
                    ) : <span style={{ color: "#ccc" }}>—</span>}
                  </td>
                  <td
                    className="tooltip-cell"
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setTooltip({ order, x: rect.right - 8, y: rect.bottom + 6, type: "revenue" });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {money(order.totals.grossRevenueCents)}
                  </td>
                  <td
                    className={`profit-cell ${saleResult >= 0 ? "positive" : "negative"} tooltip-cell`}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setTooltip({ order, x: rect.right - 8, y: rect.bottom + 6, type: "result" });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {money(saleResult)}
                  </td>
                  <td style={{ fontSize: 12, color: "#6b7280" }}>
                    {(order.saleResultPct * 100).toFixed(1)}%
                  </td>
                  <td
                    className={`profit-cell ${profit >= 0 ? "positive" : "negative"} tooltip-cell`}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setTooltip({ order, x: rect.right - 8, y: rect.bottom + 6, type: "profit" });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {money(profit)}
                  </td>
                  <td style={{ fontSize: 12, color: "#6b7280" }}>
                    {(order.marginPct * 100).toFixed(1)}%
                  </td>
                  <td>
                    <button type="button" className="icon-btn" onClick={() => handleEdit(order.id)} title="Editar">
                      <Pencil size={15} />
                    </button>
                    <button type="button" className="icon-btn icon-btn-danger" onClick={() => handleDeleteOrder(order.id)} title="Excluir">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              )})}
              {orderList.length === 0 && (
                <tr>
                  <td colSpan={15}>Sem pedidos registrados ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={orders.data?.total ?? 0} onPageChange={setPage} />
      </Panel>
      <OrderDetailModal
        orderId={detailOrderId}
        open={detailOrderId !== null}
        onClose={closeDetailModal}
        onEdit={handleEdit}
        onViewOrder={handleViewOrder}
      />
      {viewCustomer && (
        <CustomerDetailModal
          customer={viewCustomer}
          open
          onClose={() => setViewCustomer(null)}
          onEdit={() => setViewCustomer(null)}
          onViewOrder={handleViewOrder}
        />
      )}
      <OrderModal
        meta={meta}
        products={products.data?.data ?? []}
        customers={customers.data?.data ?? []}
        editingOrderId={editingOrderId}
        orderDetails={orderDetails}
        open={modalOpen}
        onClose={closeModal}
      />
      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title="Excluir Pedido"
        entityName={`pedido #${deleteTarget ?? ""}`}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDeleteModal
        open={orderBulkDeleteConfirm}
        title="Excluir Pedidos"
        entityName={`${oSel.count} pedido(s)`}
        onConfirm={() => { if (oSel.count > 0) orderBulkDeleteMutation.mutate([...oSel.selected] as number[]); }}
        onCancel={() => setOrderBulkDeleteConfirm(false)}
      />

      {tooltip && (() => {
        if (tooltip.rows) {
          return (
            <div className="tooltip-box" style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-100%, 0)" }}>
              {tooltip.rows.map((r, i) => (
                <div key={i} className="tooltip-row">
                  <span>{r.label}</span>
                  <span className={r.cls ?? ""}>{r.value}</span>
                </div>
              ))}
            </div>
          );
        }
        const o = tooltip.order!;
        if (tooltip.type === "revenue") {
          return (
            <div className="tooltip-box" style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-100%, 0)" }}>
              <div className="tooltip-row"><span>Produtos</span><span>{money(o.productsAmountCents)}</span></div>
              <div className="tooltip-row"><span>Frete Cliente</span><span>{money(o.shippingCustomerCents)}</span></div>
            </div>
          );
        }
        if (tooltip.type === "profit") {
          return (
            <div className="tooltip-box" style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-100%, 0)" }}>
              <div className="tooltip-row"><span>Resultado Venda</span><span>{money(o.totals?.saleResultCents ?? 0)}</span></div>
              {o.itemsCostCents > 0 && <div className="tooltip-row"><span>Custo Produto</span><span className="negative">{money(-o.itemsCostCents)}</span></div>}
              {o.packagingCents > 0 && <div className="tooltip-row"><span>Embalagem</span><span className="negative">{money(-o.packagingCents)}</span></div>}
              {o.additionalCostsCents > 0 && <div className="tooltip-row"><span>Custos Adicionais</span><span className="negative">{money(-o.additionalCostsCents)}</span></div>}
            </div>
          );
        }
        const netFreight = o.shippingCustomerCents - o.shippingTotalCents;
        return (
          <div className="tooltip-box" style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-100%, 0)" }}>
            <div className="tooltip-row"><span>Frete Líq.</span><span className={netFreight >= 0 ? "positive" : "negative"}>{netFreight >= 0 ? '' : '-'}{money(Math.abs(netFreight))}</span></div>
            <div className="tooltip-row"><span>Taxa</span><span className="negative">{money(-o.platformFeeCents)}</span></div>
            {o.otherCostsCents > 0 && <div className="tooltip-row"><span>Cupom</span><span className="negative">{money(-o.otherCostsCents)}</span></div>}
            <div className="tooltip-row"><span>Desconto</span><span className={o.discountCents > 0 ? "positive" : ""}>{o.discountCents > 0 ? '+' : ''}{money(o.discountCents)}</span></div>
          </div>
        );
      })()}
    </>
  );
}
