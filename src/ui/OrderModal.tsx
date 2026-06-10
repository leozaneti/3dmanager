import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Product, type Customer, type Meta, type Settings, money, toCents, fromCents } from "./api";
import { OrderFinancialSidebar } from "./OrderFinancialSidebar";
import { CustomerDetailModal } from "./CustomerDetailModal";
import { Autocomplete } from "./Autocomplete";
import { ModalShell } from "./ModalShell";
import { FormActions } from "./FormActions";

type OrderItem = {
  productId: string;
  sku: string;
  listingTitle: string;
  quantity: number;
  sale: string;
  cost: string;
};

type Props = {
  meta: Meta;
  products: Product[];
  customers: Customer[];
  editingOrderId: number | null;
  orderDetails: any;
  open: boolean;
  onClose: () => void;
};

function OrderItemRow({
  item,
  index,
  products,
  onUpdate,
  onRemove
}: {
  item: OrderItem;
  index: number;
  products: Product[];
  onUpdate: (index: number, item: OrderItem) => void;
  onRemove: (index: number) => void;
}) {
  const total = useMemo(() => item.quantity * toCents(item.sale), [item.quantity, item.sale]);
  const costTotal = useMemo(() => item.quantity * toCents(item.cost), [item.quantity, item.cost]);
  const itemProfit = total - costTotal;

  return (
    <tr>
      <td>
        <Autocomplete
          className="product-cell"
          items={products.map((p) => ({
            id: p.id,
            primary: p.name,
            secondary: money(p.currentCostCents),
            searchText: `${p.name} ${p.sku}`
          }))}
          value={item.listingTitle || (item.productId ? products.find((p) => String(p.id) === item.productId)?.name ?? "" : "")}
          onSelect={(product) => {
            const p = products.find((p) => p.id === product.id)!;
            onUpdate(index, {
              productId: String(p.id),
              sku: p.sku,
              listingTitle: p.name,
              quantity: item.quantity,
              sale: "",
              cost: fromCents(p.currentCostCents)
            });
          }}
          placeholder="Buscar produto..."
          emptyText="Nenhum produto encontrado"
        />
      </td>
      <td>
        <input
          className="cell-input"
          readOnly
          value={item.sku}
        />
      </td>
      <td>
        <input
          className="cell-input cell-input-center"
          type="number"
          min="1"
          value={item.quantity}
          onChange={(e) => onUpdate(index, { ...item, quantity: Number(e.target.value) || 1 })}
        />
      </td>
      <td>
        <input
          className="cell-input"
          value={item.sale}
          onChange={(e) => onUpdate(index, { ...item, sale: e.target.value })}
          placeholder="0,00"
        />
      </td>
      <td>
        <input
          className="cell-input"
          readOnly
          value={item.cost}
          placeholder="0,00"
        />
      </td>
      <td className="total-cell">{money(total)}</td>
      <td className="total-cell">{money(costTotal)}</td>
      <td className={`profit-cell ${itemProfit >= 0 ? "positive" : "negative"}`}>{money(itemProfit)}</td>
      <td className="action-cell">
        <button type="button" className="remove-btn" onClick={() => onRemove(index)}>✕</button>
      </td>
    </tr>
  );
}

export function OrderModal({ meta, products, customers, editingOrderId, orderDetails, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
    staleTime: 60000,
  });
  const defaultPackagingCents = Number((settingsQuery.data as any)?.["packaging_cost"]?.value ?? 0);

  const [storeId, setStoreId] = useState("");
  const [salesChannelId, setSalesChannelId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [externalOrderId, setExternalOrderId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [deliveryForecastDate, setDeliveryForecastDate] = useState("");
  const [deliveredDate, setDeliveredDate] = useState("");
  const [statusDescription, setStatusDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [shippingTotal, setShippingTotal] = useState("");
  const [shippingCustomer, setShippingCustomer] = useState("");
  const [platformFee, setPlatformFee] = useState("");
  const [discount, setDiscount] = useState("");
  const [otherCosts, setOtherCosts] = useState("");
  const [packaging, setPackaging] = useState("");
  const [additionalCosts, setAdditionalCosts] = useState("");
  const [items, setItems] = useState<OrderItem[]>([
    { productId: "", sku: "", listingTitle: "", quantity: 1, sale: "", cost: "" }
  ]);

  useEffect(() => {
    if (!open) return;
    if (editingOrderId && orderDetails?.data) {
      const order = orderDetails.data;
      setStoreId(String(order.storeId ?? ""));
      setSalesChannelId(String(order.salesChannelId ?? ""));
      setStatusId(String(order.statusId ?? ""));
      setSaleDate(order.saleDate ?? new Date().toISOString().slice(0, 10));
      setExternalOrderId(order.externalOrderId ?? "");
      setCustomerId(order.customerId ? String(order.customerId) : "");
      const cust = customers.find((c) => c.id === order.customerId);
      setCustomerName(cust?.name ?? "");
      setDeliveryForecastDate(order.deliveryForecastDate ?? "");
      setDeliveredDate(order.deliveredDate ?? "");
      setStatusDescription(order.statusDescription ?? "");
      setNotes(order.notes ?? "");
      setShippingTotal(fromCents(order.shippingTotalCents));
      setShippingCustomer(fromCents(order.shippingCustomerCents));
      setPlatformFee(fromCents(order.platformFeeCents));
      setDiscount(fromCents(order.discountCents));
      setOtherCosts(fromCents(order.otherCostsCents));
      setPackaging(fromCents(order.packagingCents));
      setAdditionalCosts(fromCents(order.additionalCostsCents));
      setItems(
        order.items.map((item: any) => ({
          productId: item.productId ? String(item.productId) : "",
          sku: item.sku ?? "",
          listingTitle: item.listingTitle ?? "",
          quantity: item.quantity,
          sale: fromCents(item.saleUnitPriceCents),
          cost: fromCents(item.costUnitCents)
        }))
      );
    } else {
      setStoreId("");
      setSalesChannelId(meta.channels[0]?.id ? String(meta.channels[0].id) : "");
      setStatusId(meta.statuses[0]?.id ? String(meta.statuses[0].id) : "");
      setSaleDate(new Date().toISOString().slice(0, 10));
      setExternalOrderId("");
      setCustomerId("");
      setCustomerName("");
      setDeliveryForecastDate("");
      setDeliveredDate("");
      setStatusDescription("");
      setNotes("");
      setShippingTotal("");
      setShippingCustomer("");
      setPlatformFee("");
      setDiscount("");
      setOtherCosts("");
      setPackaging(fromCents(defaultPackagingCents));
      setAdditionalCosts("");
      setItems([{ productId: "", sku: "", listingTitle: "", quantity: 1, sale: "", cost: "" }]);
    }
  }, [open, editingOrderId, orderDetails?.data, meta, customers]);

  const createMutation = useMutation({
    mutationFn: (body: unknown) => api("/orders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    }
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: number; body: unknown }) =>
      api(`/orders/${params.id}`, { method: "PUT", body: JSON.stringify(params.body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    }
  });

  function updateItem(index: number, item: OrderItem) {
    setItems((arr) => arr.map((it, i) => (i === index ? item : it)));
  }

  function removeItem(index: number) {
    setItems((arr) => arr.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems((arr) => [...arr, { productId: "", sku: "", listingTitle: "", quantity: 1, sale: "", cost: "" }]);
  }

  function handleCustomerSelect(customer: Customer) {
    setCustomerId(String(customer.id));
    setCustomerName(customer.name);
  }

  function handleCustomerNew(name: string) {
    api("/customers", { method: "POST", body: JSON.stringify({ name }) }).then((res: any) => {
      setCustomerId(String(res.id));
      setCustomerName(name);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    });
  }

  // Customer summary
  const customerSummary = useQuery({
    queryKey: ["customer-summary", customerId],
    queryFn: () => api<{
      totalOrders: number;
      totalRevenueCents: number;
      firstPurchase: string | null;
    }>(`/customers/${customerId}/summary`),
    enabled: !!customerId
  });

  // Items formatted for the shared sidebar
  const sidebarItems = useMemo(
    () => items.map((item) => ({
      listingTitle: item.listingTitle,
      sku: item.sku,
      quantity: item.quantity,
      saleUnitPriceCents: toCents(item.sale),
      costUnitCents: toCents(item.cost),
    })),
    [items]
  );

  // Financial calculations
  const productsTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * toCents(item.sale), 0),
    [items]
  );

  const shippingTotalCents = toCents(shippingTotal);
  const shippingCustomerCents = toCents(shippingCustomer);
  const discountCents = toCents(discount);
  const platformFeeCents = toCents(platformFee);
  const otherCostsCents = toCents(otherCosts);
  const packagingCents = toCents(packaging);
  const additionalCostsCents = toCents(additionalCosts);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = {
      storeId: Number(storeId),
      externalOrderId,
      saleDate,
      statusId: Number(statusId),
      statusDescription,
      salesChannelId: Number(salesChannelId),
      customerId: customerId ? Number(customerId) : null,
      notes,
      deliveryForecastDate,
      deliveredDate,
      financials: {
        productsAmountCents: productsTotal,
        shippingTotalCents,
        shippingCustomerCents,
        platformFeeCents,
        discountCents,
        otherCostsCents,
        packagingCents,
        additionalCostsCents
      },
      items: items.map((item) => ({
        productId: item.productId ? Number(item.productId) : null,
        sku: item.sku,
        listingTitle: item.listingTitle,
        quantity: item.quantity,
        saleUnitPriceCents: toCents(item.sale),
        costUnitCents: toCents(item.cost)
      }))
    };

    if (editingOrderId) {
      updateMutation.mutate({ id: editingOrderId, body });
    } else {
      createMutation.mutate(body);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={editingOrderId ? "Editar Pedido" : "Novo Pedido"}
      asForm
      onSubmit={submit}
    >
      <div className="modal-order-main">
        {/* Section 1: Order Data */}
        <div className="order-card">
          <div className="order-card-title">Dados do Pedido</div>
          <div className="order-grid-2">
            <div className="order-field">
              <label>Loja</label>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
                <option value="">Selecione uma loja</option>
                {meta.stores.map((st) => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </div>
            <div className="order-field">
              <label>Canal de venda</label>
              <select value={salesChannelId} onChange={(e) => setSalesChannelId(e.target.value)} required>
                {meta.channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>{ch.name}</option>
                ))}
              </select>
            </div>
            <div className="order-field">
              <label>Cliente</label>
              <Autocomplete
                className="customer-wrap"
                showSearchIcon
                items={customers.map((c) => ({
                  id: c.id,
                  primary: c.name,
                  secondary: c.phone ?? undefined,
                }))}
                value={customerName}
                onSelect={(item) => {
                  const c = customers.find((c) => c.id === item.id)!;
                  handleCustomerSelect(c);
                }}
                allowCreate={(q) => q.trim() ? { label: `+ Cadastrar "${q}"`, onCreate: () => handleCustomerNew(q) } : null}
                placeholder="Buscar cliente..."
                maxItems={10}
              />
              {customerSummary?.data && customerId && (
                <div className="customer-meta">
                  <button type="button" className="link-btn" onClick={() => {
                    const c = customers.find((c) => c.id === Number(customerId));
                    if (c) setViewCustomer(c);
                  }} style={{ fontSize: 12 }}>{customerName}</button>
                  &nbsp;&middot;&nbsp;
                  Cliente desde <strong>{customerSummary.data.firstPurchase?.slice(0, 7).replace("-", "/") ?? "---"}</strong>
                  &nbsp;&middot;&nbsp;
                  <strong>{customerSummary.data.totalOrders}</strong> pedidos
                  &nbsp;&middot;&nbsp;
                  <strong>{money(customerSummary.data.totalRevenueCents)}</strong> faturados
                </div>
              )}
            </div>
            <div className="order-field">
              <label>Pedido externo</label>
              <input
                placeholder="#12345"
                value={externalOrderId}
                onChange={(e) => setExternalOrderId(e.target.value)}
              />
            </div>
            <div className="order-field">
              <label>Data</label>
              <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} required />
            </div>
            <div className="order-field">
              <label>Status</label>
              <select value={statusId} onChange={(e) => setStatusId(e.target.value)} required>
                {meta.statuses.map((st) => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </div>
            <div className="order-field">
              <label>Previsão de entrega</label>
              <input type="date" value={deliveryForecastDate} onChange={(e) => setDeliveryForecastDate(e.target.value)} />
            </div>
            <div className="order-field">
              <label>Data de entrega</label>
              <input type="date" value={deliveredDate} onChange={(e) => setDeliveredDate(e.target.value)} />
            </div>
            <div className="order-field" style={{ gridColumn: "1 / -1" }}>
              <label>Observações</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações internas..."
              />
            </div>
          </div>
        </div>

        {/* Section 2: Items */}
        <div className="order-card" style={{ paddingBottom: "14px" }}>
          <div className="order-card-title">Itens</div>
          <table className="items-table">
            <thead>
              <tr>
                <th style={{ width: "22%" }}>Produto</th>
                <th style={{ width: "10%" }}>SKU</th>
                <th style={{ width: "7%" }}>Qtd</th>
                <th style={{ width: "11%" }}>Venda Unit.</th>
                <th style={{ width: "11%" }}>Custo Unit.</th>
                <th style={{ width: "11%" }}>Total Venda</th>
                <th style={{ width: "11%" }}>Custo Total</th>
                <th style={{ width: "11%" }}>Lucro Item</th>
                <th style={{ width: "3%" }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <OrderItemRow
                  key={idx}
                  item={item}
                  index={idx}
                  products={products}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                />
              ))}
            </tbody>
          </table>
          <button type="button" className="add-item-btn" onClick={addItem}>+ Adicionar Item</button>

        </div>

        {/* Section 3: Costs (collapsed) */}
        <div className="order-card">
          <details>
            <summary className="order-card-title costs-header">
              <span>▶</span> Custos e Taxas
            </summary>
            <div className="costs-grid">
              <div className="order-field">
                <label>Custo frete total</label>
                <input
                  value={shippingTotal}
                  onChange={(e) => setShippingTotal(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="order-field">
                <label>Frete recebido</label>
                <input
                  value={shippingCustomer}
                  onChange={(e) => setShippingCustomer(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="order-field">
                <label>Taxa plataforma</label>
                <input
                  value={platformFee}
                  onChange={(e) => setPlatformFee(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="order-field">
                <label>Desconto na Taxa</label>
                <input
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="order-field">
                <label>Cupom</label>
                <input
                  value={otherCosts}
                  onChange={(e) => setOtherCosts(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="order-field">
                <label>Embalagem</label>
                <input
                  value={packaging}
                  onChange={(e) => setPackaging(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="order-field">
                <label>Custos adicionais</label>
                <input
                  value={additionalCosts}
                  onChange={(e) => setAdditionalCosts(e.target.value)}
                  placeholder="0,00"
                />
              </div>
            </div>
          </details>
        </div>

        <FormActions onCancel={onClose} submitLabel={editingOrderId ? "Atualizar Pedido" : "Salvar Pedido"} />
      </div>

      {/* RIGHT: Financial Sidebar */}
      <OrderFinancialSidebar
        items={sidebarItems}
        shippingTotalCents={shippingTotalCents}
        shippingCustomerCents={shippingCustomerCents}
        platformFeeCents={platformFeeCents}
        discountCents={discountCents}
        otherCostsCents={otherCostsCents}
        packagingCents={packagingCents}
        additionalCostsCents={additionalCostsCents}
      />
      {viewCustomer && (
        <CustomerDetailModal
          customer={viewCustomer}
          open
          onClose={() => setViewCustomer(null)}
          onEdit={(c) => setViewCustomer(null)}
          onViewOrder={(id) => setViewCustomer(null)}
        />
      )}
    </ModalShell>
  );
}
