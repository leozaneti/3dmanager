import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeleteMutation } from "../hooks/useDeleteMutation";
import { useSelection } from "../hooks/useSelection";
import {
  BarChart3,
  Boxes,
  DatabaseBackup,
  FileX,
  Sliders,
  type LucideIcon,
  ListChecks,
  Package,
  ShoppingCart,
  UserRound,
  Wallet,
  Pencil,
  Trash2
} from "lucide-react";
import { api, AuditLogEntry, Customer, fromCents, Meta, money, OrdersResponse, Paginated, Product, type Settings as SettingsType, toCents } from "./api";
import { calculateKpisFromTotals } from "./finance";
import { CustomerDetailModal } from "./CustomerDetailModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { ImportView } from "./ImportView";
import { KanbanView } from "./KanbanView";
import { OrderDetailModal } from "./OrderDetailModal";
import { OrderModal } from "./OrderModal";
import { ModalShell } from "./ModalShell";
import { Notification } from "./Notification";
import { Dashboard } from "./dashboard/Dashboard";
import { Pagination } from "./Pagination";
import { FormActions } from "./FormActions";
import { ProductModal } from "./ProductModal";
import { Login } from "./Login";
import { Setup } from "./Setup";

type View = "dashboard" | "orders" | "products" | "customers" | "finance" | "settings" | "import" | "todos";

const nav: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "todos", label: "To-Dos", icon: ListChecks },
  { id: "orders", label: "Pedidos", icon: ShoppingCart },
  { id: "products", label: "Produtos", icon: Package },
  { id: "customers", label: "Clientes", icon: UserRound },
  { id: "finance", label: "Financeiro", icon: Wallet },
  { id: "import", label: "Importar", icon: FileX },
  { id: "settings", label: "Configurações", icon: Sliders }
];

type AuthState = "loading" | "setup" | "login" | "authenticated" | "disabled";

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [pendingOrderId, setPendingOrderId] = useState<number | null>(null);
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    fetch("/api/auth/status", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.enabled) { setAuthState("disabled"); return; }
        if (!data.configured) setAuthState("setup");
        else if (!data.authenticated) setAuthState("login");
        else setAuthState("authenticated");
      })
      .catch(() => setAuthState("disabled"));
  }, []);

  const metaEnabled = authState !== "loading" && authState !== "setup" && authState !== "login";
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: () => api<Meta>("/meta"),
    enabled: metaEnabled
  });

  if (authState === "loading") return <div className="boot">Carregando 3D Manager...</div>;
  if (authState === "setup") return <Setup onSetup={() => setAuthState("authenticated")} />;
  if (authState === "login") return <Login onLogin={() => setAuthState("authenticated")} />;

  if (metaQuery.isLoading) return <div className="boot">Carregando 3D Manager...</div>;
  if (metaQuery.error || !metaQuery.data) return <div className="boot">Erro ao iniciar.</div>;

  const meta = metaQuery.data;

  function handleViewOrderFromCustomer(orderId: number) {
    setPendingOrderId(orderId);
    setView("orders");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Boxes size={26} />
          <div>
            <strong>3D Manager</strong>
            <span>Gestão local</span>
          </div>
        </div>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="main">
      {view === "dashboard" && <Dashboard meta={meta} />}
      {view === "orders" && <Orders meta={meta} pendingOrderId={pendingOrderId} onConsumePendingOrder={() => setPendingOrderId(null)} />}
      {view === "products" && <Products meta={meta} />}
      {view === "customers" && <Customers onViewOrder={handleViewOrderFromCustomer} />}
      {view === "finance" && <FinanceMockup />}
      {view === "todos" && <KanbanView />}
      {view === "import" && <ImportView />}
      {view === "settings" && <Settings />}
      </main>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </header>
  );
}

function FinanceMockup() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCostType, setFilterCostType] = useState("");

  /* Date presets */
  function setPreset(label: string) {
    const now = new Date();
    if (label === "Hoje") { setStartDate(today); setEndDate(today); }
    else if (label === "7D") { const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); setStartDate(d.toISOString().split("T")[0]); setEndDate(today); }
    else if (label === "30D") { setStartDate(thirtyDaysAgo); setEndDate(today); }
    else if (label === "Este mês") { setStartDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]); setEndDate(today); }
    else if (label === "Todo período") { setStartDate(""); setEndDate(""); }
  }

  const qs = new URLSearchParams();
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);
  if (filterType) qs.set("type", filterType);
  if (filterCategory) qs.set("category", filterCategory);
  if (filterCostType) qs.set("costType", filterCostType);
  const sq = qs.toString();

  const transactions = useQuery({
    queryKey: ["transactions", sq],
    queryFn: () => api<{ data: any[]; total: number }>(`/transactions?${sq}`),
  });
  const dre = useQuery({
    queryKey: ["dre", startDate, endDate],
    queryFn: () => api<any>(`/finance/dre?startDate=${startDate || ""}&endDate=${endDate || ""}`),
  });
  const openingBalance = useQuery({
    queryKey: ["opening-balance"],
    queryFn: () => api<{ openingBalanceCents: number }>("/finance/opening-balance"),
  });
  const categories = useQuery({
    queryKey: ["finance-categories"],
    queryFn: () => api<{ data: { id: number; name: string; type: string; color: string }[] }>("/finance/categories"),
  });

  const incomeCents = (transactions.data?.data ?? []).filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + t.amountCents, 0);
  const expenseCents = (transactions.data?.data ?? []).filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + t.amountCents, 0);
  const openingBalanceCents = openingBalance.data?.openingBalanceCents ?? 520000;
  const balanceCents = openingBalanceCents + incomeCents - expenseCents;

  const d = dre.data;
  const realized = d?.orders?.realized ?? {};
  const pending = d?.orders?.pending ?? {};
  const txVar = d?.transactions?.variableExpenses ?? { total: 0, count: 0 };
  const txFix = d?.transactions?.fixedExpenses ?? { total: 0, count: 0 };
  const txOther = d?.transactions?.otherIncome ?? { total: 0, count: 0 };

  function calcDreRow(real: Record<string, number>, pend: Record<string, number>) {
    const gross = (real.productsAmountCents ?? 0) + (real.shippingCustomerCents ?? 0) - (real.discountCents ?? 0);
    const deductions = (real.platformFeeCents ?? 0) + (real.shippingTotalCents ?? 0) + (real.otherCostsCents ?? 0);
    const net = gross - deductions;
    const prodCost = real.itemsCostCents ?? 0;
    const pack = real.packagingCents ?? 0;
    const contribution = net - prodCost - pack - txVar.total;
    const netResult = contribution - txFix.total + txOther.total;

    const grossP = (pend.productsAmountCents ?? 0) + (pend.shippingCustomerCents ?? 0) - (pend.discountCents ?? 0);
    const deductionsP = (pend.platformFeeCents ?? 0) + (pend.shippingTotalCents ?? 0) + (pend.otherCostsCents ?? 0);
    const netP = grossP - deductionsP;
    const prodCostP = pend.itemsCostCents ?? 0;
    const packP = pend.packagingCents ?? 0;
    const contributionP = netP - prodCostP - packP;
    const netResultP = contributionP;

    const totalGross = gross + grossP;
    const pct = (v: number) => totalGross > 0 ? ((v / totalGross) * 100).toFixed(1) : "0.0";

    return {
      rows: [
        { label: "Receita bruta dos pedidos", pct: pct(gross + grossP), realized: gross, pending: grossP, cls: "finance-dre-section" },
        { label: "(-) Deduções variáveis (taxas, fretes, descontos)", pct: pct(deductions + deductionsP), realized: -deductions, pending: -deductionsP, cls: "finance-dre-negative" },
        { label: "Receita líquida", pct: pct(net + netP), realized: net, pending: netP, cls: "finance-dre-total" },
        { label: "(-) Custo dos produtos", pct: pct(prodCost + prodCostP), realized: -prodCost, pending: -prodCostP, cls: "finance-dre-negative" },
        { label: "(-) Embalagens", pct: pct(pack + packP), realized: -pack, pending: -packP, cls: "finance-dre-negative" },
        { label: "(-) Despesas variáveis", pct: pct(txVar.total), realized: -txVar.total, pending: 0, cls: "finance-dre-negative" },
        { label: "MARGEM DE CONTRIBUIÇÃO", pct: pct(contribution + contributionP), realized: contribution, pending: contributionP, cls: "finance-dre-result", borderTop: true },
        { label: "(-) Despesas fixas", pct: pct(txFix.total), realized: -txFix.total, pending: 0, cls: "finance-dre-negative" },
        { label: "(+) Outras receitas", pct: pct(txOther.total), realized: txOther.total, pending: 0, cls: "finance-dre-positive" },
        { label: "RESULTADO LÍQUIDO", pct: pct(netResult + netResultP), realized: netResult, pending: netResultP, cls: "finance-dre-result" },
      ],
    };
  }

  const dreRows = calcDreRow(realized, pending).rows;

  /* ── Transaction modal state ── */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<any>(null);
  const [txType, setTxType] = useState<"income" | "expense">("income");
  const [txCategory, setTxCategory] = useState("Vendas");
  const [txDate, setTxDate] = useState(today);
  const [txDescription, setTxDescription] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txCostType, setTxCostType] = useState("variable");
  const [txOrderIds, setTxOrderIds] = useState<number[]>([]);
  const [orderSearch, setOrderSearch] = useState("");

  /* ── Category modal state ── */
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState<"income" | "expense">("expense");

  const deliveredOrders = useQuery({
    queryKey: ["orders-delivered"],
    queryFn: () => api<any>(`/orders?limit=200&statusId=4`),
  });

  const filteredOrders = (deliveredOrders.data?.data ?? []).filter((o: any) =>
    orderSearch
      ? o.id.toString().includes(orderSearch)
        || o.externalOrderId?.includes(orderSearch)
        || o.customerName?.toLowerCase().includes(orderSearch.toLowerCase())
      : true
  ).slice(0, 10);

  const catList = categories.data?.data ?? [];

  const hasAutoCalc = txType === "income" && txOrderIds.length > 0;
  const autoValue = useQuery({
    queryKey: ["order-totals", [...txOrderIds].sort().join(",")],
    queryFn: () => api<{ amountReceivedCents: number }>(`/orders/totals?ids=${txOrderIds.join(",")}`),
    enabled: hasAutoCalc,
  });
  const autoAmountCents = autoValue.data?.amountReceivedCents ?? 0;
  const autoLoading = hasAutoCalc && autoValue.isFetching;

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id?: number; body: any }) =>
      id ? api(`/transactions/${id}`, { method: "PUT", body: JSON.stringify(body) }) : api("/transactions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dre"] });
      setModalOpen(false);
      resetForm();
    },
    onError: (err) => alert("Erro ao salvar: " + (err instanceof Error ? err.message : "Erro desconhecido")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api(`/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dre"] });
    },
    onError: (err) => alert("Erro ao excluir: " + (err instanceof Error ? err.message : "Erro desconhecido")),
  });

  const createCatMutation = useMutation({
    mutationFn: (body: any) => api("/finance/categories", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["finance-categories"] });
      setNewCatName("");
    },
    onError: (err) => alert("Erro ao criar categoria: " + (err instanceof Error ? err.message : "Erro desconhecido")),
  });

  const deleteCatMutation = useMutation({
    mutationFn: (id: number) => api(`/finance/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance-categories"] }),
    onError: (err) => alert("Erro ao excluir categoria: " + (err instanceof Error ? err.message : "Erro desconhecido")),
  });

  function openCreateModal() {
    resetForm();
    setModalOpen(true);
  }

  function openEditModal(tx: any) {
    setEditingTx(tx);
    setTxType(tx.type);
    setTxCategory(tx.category);
    setTxDate(tx.date);
    setTxDescription(tx.description || "");
    setTxAmount(((tx.amountCents ?? 0) / 100).toFixed(2).replace(".", ","));
    setTxCostType(tx.costType || "variable");
    setTxOrderIds(tx.orders?.map((o: any) => o.id) ?? []);
    setOrderSearch("");
    setModalOpen(true);
  }

  function resetForm() {
    setTxType("income"); setTxCategory("Vendas"); setTxDate(today);
    setTxDescription(""); setTxAmount(""); setTxCostType("variable"); setTxOrderIds([]); setOrderSearch("");
    setEditingTx(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = hasAutoCalc
      ? autoAmountCents
      : Math.round(Number((txAmount ?? "0").replace(/\./g, "").replace(",", ".")) * 100);
    const body = {
      date: txDate, type: txType, category: txCategory, description: txDescription,
      amountCents,
      costType: txType === "expense" ? txCostType : null,
      orderIds: txOrderIds,
    };
    saveMutation.mutate({ id: editingTx?.id, body });
  }

  return (
    <>
      <Header title="Financeiro" subtitle="Fluxo de caixa: entradas, saídas e resultado do período." />

      <section className="kpi-section">
        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiCard label="Saldo atual" value={money(balanceCents)} sub="Saldo inicial + movimentações" onMouseEnter={() => {}} onMouseLeave={() => {}} />
          <KpiCard label="Entradas" value={money(incomeCents)} sub="No período selecionado" />
          <KpiCard label="Saídas" value={money(expenseCents)} sub="No período selecionado" />
        </div>
      </section>

      <div className="toolbar">
        <div className="date-filter">
          <button type="button" onClick={() => setPreset("Hoje")}>Hoje</button>
          <button type="button" onClick={() => setPreset("7D")}>7D</button>
          <button type="button" onClick={() => setPreset("30D")}>30D</button>
          <button type="button" onClick={() => setPreset("Este mês")}>Este mês</button>
          <button type="button" onClick={() => setPreset("Todo período")}>Todo período</button>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span style={{ color: "#888" }}>até</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">Todas categorias</option>
          {catList.map((c: any) => <option key={c.id}>{c.name}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">Todos tipos</option>
          <option value="income">Entradas</option>
          <option value="expense">Saídas</option>
        </select>
        <select value={filterCostType} onChange={(e) => setFilterCostType(e.target.value)}>
          <option value="">Todos custos</option>
          <option value="fixed">Custos fixos</option>
          <option value="variable">Custos variáveis</option>
        </select>
        <button type="button" onClick={() => setCategoryModalOpen(true)} style={{ background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
          Categorias
        </button>
        <button type="button" onClick={openCreateModal}>Nova movimentação</button>
      </div>

      <Panel title="Movimentações de caixa">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Classificação</th>
                <th>Pedidos vinculados</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {(transactions.data?.data ?? []).map((t: any) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.date)}</td>
                  <td>
                    <strong style={{ display: "block", fontSize: 13 }}>{t.description}</strong>
                    <span style={{ color: "#888", fontSize: 12 }}>{t.type === "income" ? "Entrada" : "Saída"}</span>
                  </td>
                  <td><span className={`tag ${t.type === "income" ? "tag-green" : "tag-red"}`}>{t.category}</span></td>
                  <td>
                    {t.type === "expense" ? (
                      <span className={`tag ${t.costType === "fixed" ? "tag-blue" : "tag-gold"}`}>
                        {t.costType === "fixed" ? "Fixo" : "Variável"}
                      </span>
                    ) : <span style={{ color: "#999" }}>-</span>}
                  </td>
                  <td>
                    {t.orders?.length ? (
                      <div className="finance-order-links">
                        {t.orders.map((o: any) => (
                          <button key={o.id} type="button" className="link-btn">
                            #{o.id}{o.externalOrderId ? ` · ${o.externalOrderId}` : ""}
                          </button>
                        ))}
                      </div>
                    ) : <span style={{ color: "#999" }}>-</span>}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: t.type === "income" ? "#059669" : "#dc2626" }}>
                    {t.type === "income" ? "+" : "-"}{money(t.amountCents)}
                  </td>
                  <td>
                    <button type="button" className="icon-btn" title="Editar" onClick={() => openEditModal(t)}><Pencil size={15} /></button>
                    <button type="button" className="icon-btn icon-btn-danger" title="Excluir" onClick={() => { if (confirm("Excluir transação?")) deleteMutation.mutate(t.id); }}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="DRE do período">
        <div className="finance-dre">
          <div className="finance-dre-row finance-dre-header">
            <span>Conta</span>
            <span>%</span>
            <strong>Realizado</strong>
            <strong className="dre-pending">A Realizar</strong>
          </div>
          {dreRows.map((row, i) => (
            <div key={i} className={"finance-dre-row " + row.cls + (row.realized < 0 && row.label === "RESULTADO LÍQUIDO" ? " negative" : "")} style={row.borderTop ? { borderTop: "2px solid #ddd" } : {}}>
              <span>{row.label}</span>
              <span>{row.pct}%</span>
              <strong style={row.realized < 0 ? { color: "#dc2626" } : row.realized > 0 && row.label.startsWith("(+)") ? { color: "#059669" } : {}}>{row.realized >= 0 ? money(row.realized) : `-${money(-row.realized)}`}</strong>
              <strong className="dre-pending" style={row.pending < 0 ? { color: "#dc2626" } : {}}>{row.pending >= 0 ? money(row.pending) : `-${money(-row.pending)}`}</strong>
            </div>
          ))}
        </div>
      </Panel>

      {/* Transaction modal */}
      <ModalShell open={modalOpen} onClose={() => { setModalOpen(false); setEditingTx(null); }} title={editingTx ? "Editar movimentação" : "Nova movimentação financeira"} asForm onSubmit={handleSubmit}>
        <div className="modal-order-main">
          <div className="order-card">
            <div className="order-card-title">Dados da movimentação</div>
            <div className="order-grid-3">
              <div className="order-field">
                <label>Tipo</label>
                <select value={txType} onChange={(e) => setTxType(e.target.value as any)}>
                  <option value="income">Entrada</option>
                  <option value="expense">Saída</option>
                </select>
              </div>
              <div className="order-field">
                <label>Categoria</label>
                <div className="finance-category-picker">
                  <select value={txCategory} onChange={(e) => setTxCategory(e.target.value)}>
                    {catList.map((c: any) => <option key={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setCategoryModalOpen(true)}>Gerenciar</button>
                </div>
              </div>
              <div className="order-field">
                <label>Data</label>
                <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
              </div>
              <div className="order-field" style={{ gridColumn: "span 2" }}>
                <label>Descrição</label>
                <input value={txDescription} onChange={(e) => setTxDescription(e.target.value)} placeholder="Descrição da movimentação" />
              </div>
              <div className="order-field">
                <label>Valor (R$)</label>
                <input value={hasAutoCalc && !autoLoading ? fromCents(autoAmountCents) : txAmount}
                       onChange={(e) => setTxAmount(e.target.value)}
                       placeholder="0,00"
                       disabled={hasAutoCalc} />
                {autoLoading && <span style={{ fontSize: 11, color: "#888" }}>Calculando...</span>}
                {hasAutoCalc && !autoLoading && <span style={{ fontSize: 11, color: "#888" }}>Calculado dos pedidos</span>}
              </div>
              {txType === "expense" && (
                <div className="order-field">
                  <label>Classificação de custo</label>
                  <select value={txCostType} onChange={(e) => setTxCostType(e.target.value)}>
                    <option value="variable">Custo variável</option>
                    <option value="fixed">Custo fixo</option>
                  </select>
                </div>
              )}
            </div>
          </div>
          {txType === "income" && txCategory === "Vendas" && (
            <div className="order-card">
              <div className="order-card-title">Vincular pedidos entregues</div>
              <div className="finance-linked-orders-mock">
                <input placeholder="Buscar por #ID ou nome do cliente..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} />
                {filteredOrders.map((o: any) => {
                  const selected = txOrderIds.includes(o.id);
                  return (
                    <div key={o.id} className="finance-linked-order-row" style={{ cursor: "pointer", opacity: selected ? 1 : 0.6 }} onClick={() => {
                      setTxOrderIds((prev) => selected ? prev.filter((id) => id !== o.id) : [...prev, o.id]);
                    }}>
                      <span>#{o.id}{o.externalOrderId ? ` · ${o.externalOrderId}` : ""} · {o.customerName || "—"}</span>
                      <span style={{ color: selected ? "#059669" : "#999", fontWeight: 700 }}>{selected ? "✓" : "+"}</span>
                    </div>
                  );
                })}
                {txOrderIds.length > 0 && (
                  <div style={{ fontSize: 12, color: "#666", padding: "4px 0" }}>
                    {txOrderIds.length} pedido(s) vinculado(s)
                  </div>
                )}
              </div>
            </div>
          )}
          <FormActions onCancel={() => { setModalOpen(false); setEditingTx(null); }} submitLabel={editingTx ? "Atualizar" : "Salvar"} submitting={saveMutation.isPending || autoLoading} />
        </div>
      </ModalShell>

      {/* Category modal */}
      <ModalShell open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} title="Gerenciar categorias" maxWidth="560px">
        <div className="modal-order-main">
          <div className="order-card">
            <div className="order-card-title">Nova categoria</div>
            <div className="finance-category-form-row">
              <input placeholder="Nome da categoria" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} />
              <select value={newCatType} onChange={(e) => setNewCatType(e.target.value as any)}>
                <option value="income">Receita</option>
                <option value="expense">Despesa</option>
              </select>
              <button type="button" disabled={!newCatName || createCatMutation.isPending} onClick={() => createCatMutation.mutate({ name: newCatName, type: newCatType })}>
                Adicionar
              </button>
            </div>
          </div>
          <div className="order-card">
            <div className="order-card-title">Categorias existentes</div>
            <div className="finance-category-list">
              {catList.map((cat: any) => (
                <div key={cat.id} className="finance-category-list-row">
                  <div>
                    <strong>{cat.name}</strong>
                    <span className={`tag ${cat.color}`}>{cat.type === "income" ? "Receita" : "Despesa"}</span>
                  </div>
                  <button type="button" className="icon-btn icon-btn-danger" onClick={() => { if (confirm(`Excluir categoria "${cat.name}"?`)) deleteCatMutation.mutate(cat.id); }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ModalShell>
    </>
  );
}

function KpiCard({ label, value, sub, onMouseEnter, onMouseLeave }: { label: string; value: string | number; sub?: string; onMouseEnter?: (e: React.MouseEvent) => void; onMouseLeave?: () => void }) {
  return (
    <div className="kpi-card" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function KpiHero({ label, value, margin, compare, compareDir, onMouseEnter, onMouseLeave }: { label: string; value: string; margin?: number; compare?: string; compareDir?: "up" | "down"; onMouseEnter?: (e: React.MouseEvent) => void; onMouseLeave?: () => void }) {
  const positive = (margin ?? 0) >= 0;
  return (
    <div className={`kpi-hero${positive ? "" : " negative"}`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value kpi-hero-value">{value}</strong>
      {compare && compareDir ? (
        <span className={`kpi-hero-compare ${compareDir === "up" ? "" : ""}`}>
          {compareDir === "up" ? "▲" : "▼"} {compare}
        </span>
      ) : (
        <span className="kpi-hero-margin">Margem: {(margin ?? 0).toFixed(1)}%</span>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function FormCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="form-card">
      <div className="form-card-header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <div className="form-card-body">{children}</div>
    </section>
  );
}

function Field({ label, optional, hint, children }: { label: string; optional?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        {label}
        {optional ? <span className="field-optional">Opcional</span> : null}
      </div>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

// Notification component imported from ./Notification

function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
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
    totalItems: "Itens",
    avgTicketCents: "Ticket",
    totalCostCents: "Custos",
    shippingSubsidyCents: "Frete sub."
  };
  return (
    <div className="table-wrap">
      <table>
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
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{column.endsWith("Cents") ? money(row[column]) : row[column]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getVal(obj: any, path: string) {
  return path.split(".").reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

function useSort<T>(data: T[], defaultSort: string) {
  const [sortBy, setSortBy] = useState(defaultSort);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (key === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    const list = [...data];
    list.sort((a, b) => {
      const va = getVal(a, sortBy);
      const vb = getVal(b, sortBy);
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, sortBy, sortDir]);

  return { sorted, sortBy, sortDir, handleSort };
}

function Products({ meta }: { meta: Meta }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const qs = `?search=${encodeURIComponent(search)}&limit=${pageSize}&offset=${page * pageSize}`;
  const products = useQuery({
    queryKey: ["products", search, page],
    queryFn: () => api<Paginated<Product>>(`/products${qs}`)
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<any>("/settings") });
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [message, setMessage] = useState("");

  const deleteMutation = useDeleteMutation({
    endpoint: "/products",
    queryKeysToInvalidate: [["products"]],
    onSuccess: () => {
      setMessage("Produto excluído com sucesso.");
      setDeleteTarget(null);
    },
    onError: (err) => {
      setMessage(`Erro ao excluir produto: ${err.message}`);
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api("/products/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setMessage("Produtos excluídos com sucesso.");
      sel.clear();
      setBulkDeleteConfirm(false);
    },
    onError: (err) => {
      setMessage(`Erro ao excluir produtos: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
      setBulkDeleteConfirm(false);
    }
  });

  function openCreateModal() {
    setEditing(null);
    setModalOpen(true);
  }

  function handleDelete(id: number, name: string) {
    setDeleteTarget({ id, name });
  }

  const prodList = products.data?.data ?? [];
  const prodTotal = products.data?.total ?? 0;
  const prodActive = prodList.filter(p => p.active).length;
  const prodInactive = prodTotal - prodActive;
  const { sorted: sortedProducts, sortBy: sProdBy, sortDir: sProdDir, handleSort: sProdSort } = useSort(prodList, "name");

  const sel = useSelection(prodList);

  return (
    <>
      <Header title="Produtos" subtitle="Ficha técnica com cálculo automático de custo de produção." />
      <section className="kpi-section">
        <div className="kpi-row">
          <KpiCard label="Total" value={prodTotal} />
          <KpiCard label="Ativos" value={prodActive} />
          <KpiCard label="Inativos" value={prodInactive} />
          <KpiCard label="Custo médio" value={prodList.length ? money(Math.round(prodList.reduce((s, p) => s + p.currentCostCents, 0) / prodList.length)) : "—"} />
        </div>
      </section>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar produtos..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          style={{ flex: 1, maxWidth: 320 }}
        />
        <button type="button" onClick={openCreateModal}>
          Adicionar novo
        </button>
      </div>
      <Notification message={message} onClose={() => setMessage("")} />

      {sel.count > 0 && (
        <div className="bulk-bar">
          <span><strong>{sel.count}</strong> produto(s) selecionado(s)</span>
          <button className="bulk-delete-btn" onClick={() => setBulkDeleteConfirm(true)}>
            Excluir selecionados
          </button>
        </div>
      )}

      <Panel title="Produtos cadastrados">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="col-checkbox">
                  <input type="checkbox" checked={sel.allSelected} onChange={sel.toggleAll} />
                </th>
                <th className={`sortable ${sProdBy === "name" ? sProdDir : ""}`} onClick={() => sProdSort("name")}>Nome</th>
                <th className={`sortable ${sProdBy === "sku" ? sProdDir : ""}`} onClick={() => sProdSort("sku")}>SKU</th>
                <th className={`sortable ${sProdBy === "weightGrams" ? sProdDir : ""}`} onClick={() => sProdSort("weightGrams")}>Peso</th>
                <th className={`sortable ${sProdBy === "printTimeMinutes" ? sProdDir : ""}`} onClick={() => sProdSort("printTimeMinutes")}>Tempo</th>
                <th className={`sortable ${sProdBy === "currentCostCents" ? sProdDir : ""}`} onClick={() => sProdSort("currentCostCents")}>Custo Total</th>
                <th className={`sortable ${sProdBy === "active" ? sProdDir : ""}`} onClick={() => sProdSort("active")}>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedProducts.map((product) => (
                <tr key={product.id}>
                  <td className="col-checkbox">
                    <input type="checkbox" checked={sel.selected.has(product.id)} onChange={() => sel.toggleOne(product.id)} />
                  </td>
                  <td>{product.name}</td>
                  <td>{product.sku}</td>
                  <td>{product.weightGrams ? `${product.weightGrams}g` : "-"}</td>
                  <td>{product.printTimeMinutes ? `${product.printTimeMinutes}min` : "-"}</td>
                  <td>{money(product.currentCostCents)}</td>
                  <td>{product.active ? "Ativo" : "Inativo"}</td>
                  <td>
                    <button type="button" className="icon-btn" onClick={() => { setEditing(product); setModalOpen(true); }} title="Editar">
                      <Pencil size={15} />
                    </button>
                    <button type="button" className="icon-btn icon-btn-danger" onClick={() => handleDelete(product.id, product.name)} title="Excluir">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {(products.data?.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={8}>Sem produtos cadastrados ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={prodTotal} onPageChange={setPage} />
      </Panel>
      <ProductModal
        settings={settings.data ?? null}
        editing={editing}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
      />
      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title="Excluir Produto"
        entityName={deleteTarget?.name ?? ""}
        dependencyEndpoint={deleteTarget ? `/products/${deleteTarget.id}/dependencies` : undefined}
        dependencyQueryKey={deleteTarget ? ["product-deps", String(deleteTarget.id)] : undefined}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDeleteModal
        open={bulkDeleteConfirm}
        title="Excluir Produtos"
        entityName={`${sel.count} produto(s)`}
        onConfirm={() => { if (sel.count > 0) bulkDeleteMutation.mutate([...sel.selected] as number[]); }}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </>
  );
}

function cleanDigits(value: string) {
  return value.replace(/\D/g, "");
}

function validateCpf(digits: string) {
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let rest = ((sum * 10) % 11) % 10;
  if (rest !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  rest = ((sum * 10) % 11) % 10;
  return rest === Number(digits[10]);
}

function validateCnpj(digits: string) {
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * w1[i];
  let rest = sum % 11;
  if (rest < 2 ? 0 : 11 - rest !== Number(digits[12])) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(digits[i]) * w2[i];
  rest = sum % 11;
  return (rest < 2 ? 0 : 11 - rest) === Number(digits[13]);
}

function validateDocument(value: string) {
  const digits = cleanDigits(value);
  if (!digits) return "";
  if (digits.length === 11) return validateCpf(digits) ? "" : "CPF inválido";
  if (digits.length === 14) return validateCnpj(digits) ? "" : "CNPJ inválido";
  return "CPF deve ter 11 dígitos ou CNPJ 14 dígitos";
}

function Customers({ onViewOrder }: { onViewOrder: (orderId: number) => void }) {
  const queryClient = useQueryClient();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allTime, setAllTime] = useState(true);
  const [filterOrderCount, setFilterOrderCount] = useState("");
  const [filterState, setFilterState] = useState("");
  const custParams = new URLSearchParams();
  if (search) custParams.set("search", search);
  if (!allTime) {
    if (startDate) custParams.set("startDate", startDate);
    if (endDate) custParams.set("endDate", endDate);
  }
  if (filterOrderCount === "0") {
    custParams.set("minOrders", "0");
    custParams.set("maxOrders", "0");
  } else if (filterOrderCount === "1") {
    custParams.set("minOrders", "1");
    custParams.set("maxOrders", "1");
  } else if (filterOrderCount) {
    custParams.set("minOrders", filterOrderCount);
  }
  if (filterState) custParams.set("state", filterState);
  custParams.set("limit", String(pageSize));
  custParams.set("offset", String(page * pageSize));
  const cqs = custParams.toString();
  const customers = useQuery({
    queryKey: ["customers", search, allTime, startDate, endDate, filterOrderCount, filterState, page],
    queryFn: () => api<Paginated<Customer>>(`/customers${cqs ? `?${cqs}` : ""}`)
  });
  const [custBulkDeleteConfirm, setCustBulkDeleteConfirm] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [message, setMessage] = useState("");

  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [documentTouched, setDocumentTouched] = useState(false);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [cep, setCep] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [notes, setNotes] = useState("");
  const [cepAutoFilled, setCepAutoFilled] = useState(false);

  const createMutation = useMutation({
    mutationFn: (body: unknown) => api("/customers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setMessage("Cliente salvo com sucesso.");
      closeModal();
    }
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/customers/${body.id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setMessage("Cliente atualizado com sucesso.");
      closeModal();
    }
  });

  const deleteMutation = useDeleteMutation({
    endpoint: "/customers",
    queryKeysToInvalidate: [["customers"]],
    onSuccess: () => {
      setMessage("Cliente excluído com sucesso.");
      setDeleteTarget(null);
    },
    onError: (err) => {
      setMessage(`Erro ao excluir cliente: ${err.message}`);
    }
  });

  const custBulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => api("/customers/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setMessage("Clientes excluídos com sucesso.");
      cSel.clear();
      setCustBulkDeleteConfirm(false);
    },
    onError: (err) => {
      setMessage(`Erro ao excluir clientes: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
      setCustBulkDeleteConfirm(false);
    }
  });

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      setName(editing.name);
      setDocument(editing.document ?? "");
      setDocumentError("");
      setDocumentTouched(false);
      setPhone(editing.phone ?? "");
      setEmail(editing.email ?? "");
      setCep(editing.cep ?? "");
      setLogradouro(editing.logradouro ?? "");
      setNumero(editing.numero ?? "");
      setComplemento(editing.complemento ?? "");
      setBairro(editing.bairro ?? "");
      setCidade(editing.cidade ?? "");
      setEstado(editing.estado ?? "");
      setNotes(editing.notes ?? "");
      setCepAutoFilled(false);
    } else {
      setName("");
      setDocument("");
      setDocumentError("");
      setDocumentTouched(false);
      setPhone("");
      setEmail("");
      setCep("");
      setCepLoading(false);
      setLogradouro("");
      setNumero("");
      setComplemento("");
      setBairro("");
      setCidade("");
      setEstado("");
      setNotes("");
      setCepAutoFilled(false);
    }
  }, [modalOpen, editing]);

  function handleDocumentChange(value: string) {
    setDocument(value);
    setDocumentTouched(true);
    const digits = cleanDigits(value);
    if (!digits) {
      setDocumentError("");
    } else {
      setDocumentError(validateDocument(value));
    }
  }

  async function handleCepBlur() {
    const digits = cleanDigits(cep);
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) {
        setCepLoading(false);
        return;
      }
      setLogradouro(data.logradouro ?? "");
      setBairro(data.bairro ?? "");
      setCidade(data.localidade ?? "");
      setEstado(data.uf ?? "");
      setCepAutoFilled(true);
    } catch {
    }
    setCepLoading(false);
  }

  function openCreateModal() {
    setEditing(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const err = validateDocument(document);
    if (err) return;
    const payload = {
      name, document, phone, email,
      cep, logradouro, numero, complemento, bairro, cidade, estado,
      notes
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function handleDelete(id: number, name: string) {
    setDeleteTarget({ id, name });
  }

  function handleViewEdit(customer: Customer) {
    setViewing(null);
    setEditing(customer);
    setModalOpen(true);
  }

  function closeDetailModal() {
    setViewing(null);
  }

  function setCustomerDatePreset(preset: string) {
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
      case "all":
        setStartDate("");
        setEndDate("");
        setAllTime(true);
        break;
    }
    setPage(0);
  }

  if (!modalOpen && editing) return null;

  const docDigits = cleanDigits(document);
  const docValid = documentTouched && docDigits.length > 0 && !documentError;
  const docInvalid = documentTouched && docDigits.length > 0 && !!documentError;

  const custList = customers.data?.data ?? [];
  const custTotal = customers.data?.total ?? 0;

  const customerKpis = useMemo(() => {
    return custList.map((c) => {
      const kpis = (c.orderCount ?? 0) > 0 ? calculateKpisFromTotals({
        productsAmountCents: c.totalProductsAmountCents ?? 0,
        shippingCustomerCents: c.totalShippingCustomerCents ?? 0,
        shippingTotalCents: c.totalShippingTotalCents ?? 0,
        platformFeeCents: c.totalPlatformFeeCents ?? 0,
        otherCostsCents: c.totalOtherCostsCents ?? 0,
        discountCents: c.totalDiscountCents ?? 0,
        itemsCostCents: c.totalItemsCostCents ?? 0,
        packagingCents: c.totalPackagingCents ?? 0,
        additionalCostsCents: c.totalAdditionalCostsCents ?? 0,
      }) : null;
      return { ...c, ...(kpis ?? { grossRevenueCents: 0, profitCents: 0 }) };
    });
  }, [custList]);

  const globalKpis = useMemo(() => {
    const acc = custList.reduce(
      (a, c) => ({
        prod: a.prod + (c.totalProductsAmountCents ?? 0),
        shipCust: a.shipCust + (c.totalShippingCustomerCents ?? 0),
        shipTot: a.shipTot + (c.totalShippingTotalCents ?? 0),
        fees: a.fees + (c.totalPlatformFeeCents ?? 0),
        disc: a.disc + (c.totalDiscountCents ?? 0),
        other: a.other + (c.totalOtherCostsCents ?? 0),
        items: a.items + (c.totalItemsCostCents ?? 0),
        pkg: a.pkg + (c.totalPackagingCents ?? 0),
        add: a.add + (c.totalAdditionalCostsCents ?? 0),
      }),
      { prod: 0, shipCust: 0, shipTot: 0, fees: 0, disc: 0, other: 0, items: 0, pkg: 0, add: 0 }
    );
    return {
      ...calculateKpisFromTotals({
        productsAmountCents: acc.prod,
        shippingCustomerCents: acc.shipCust,
        shippingTotalCents: acc.shipTot,
        platformFeeCents: acc.fees,
        otherCostsCents: acc.other,
        discountCents: acc.disc,
        itemsCostCents: acc.items,
        packagingCents: acc.pkg,
        additionalCostsCents: acc.add,
      }),
      totalOrders: custList.reduce((s, c) => s + (c.orderCount ?? 0), 0),
    };
  }, [custList]);

  const vipThreshold = useMemo(() => {
    const revs = customerKpis.map(c => c.grossRevenueCents).filter(r => r > 0).sort((a, b) => b - a);
    if (revs.length === 0) return 0;
    return revs[Math.max(0, Math.floor(revs.length * 0.1) - 1)];
  }, [customerKpis]);

  const ufs = [
    "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
    "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
  ];

  const { sorted: sortedCust, sortBy: sCustBy, sortDir: sCustDir, handleSort: sCustSort } = useSort(customerKpis, "name");
  const cSel = useSelection(custList);

  return (
    <>
      <Header title="Clientes" subtitle="Cadastro de compradores com endereço." />
      <section className="kpi-section">
        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiCard label="Total" value={custTotal} />
          <KpiCard label="Receita total" value={money(globalKpis.grossRevenueCents)} />
          <KpiCard label="Lucro total" value={money(globalKpis.profitCents)} />
        </div>
      </section>
      <div className="toolbar">
        <div className="date-filter">
          <button type="button" className={!allTime && startDate === todayStr && endDate === todayStr ? "active" : ""} onClick={() => setCustomerDatePreset("today")}>Hoje</button>
          <button type="button" onClick={() => setCustomerDatePreset("yesterday")}>Ontem</button>
          <button type="button" onClick={() => setCustomerDatePreset("7d")}>7D</button>
          <button type="button" onClick={() => setCustomerDatePreset("15d")}>15D</button>
          <button type="button" onClick={() => setCustomerDatePreset("30d")}>30D</button>
          <button type="button" onClick={() => setCustomerDatePreset("month")}>Este mês</button>
          <button type="button" onClick={() => setCustomerDatePreset("lastmonth")}>Mês passado</button>
          <button type="button" className={allTime ? "active" : ""} onClick={() => setCustomerDatePreset("all")}>Todo período</button>
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setAllTime(false); setPage(0); }} />
          <span style={{ color: "#888" }}>até</span>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setAllTime(false); setPage(0); }} />
        </div>
        <input
          type="search"
          placeholder="Buscar clientes..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          style={{ flex: 1, maxWidth: 220 }}
        />
        <select value={filterOrderCount} onChange={(e) => { setFilterOrderCount(e.target.value); setPage(0); }} style={{ maxWidth: 140 }}>
          <option value="">Pedidos</option>
          <option value="0">0 pedidos</option>
          <option value="1">1 pedido</option>
          <option value="2">2+ pedidos</option>
          <option value="5">5+ pedidos</option>
          <option value="10">10+ pedidos</option>
        </select>
        <select value={filterState} onChange={(e) => { setFilterState(e.target.value); setPage(0); }} style={{ maxWidth: 100 }}>
          <option value="">Todos UF</option>
          {ufs.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
        </select>
        <button type="button" onClick={openCreateModal}>
          Adicionar novo
        </button>
      </div>
      <Notification message={message} onClose={() => setMessage("")} />

      {cSel.count > 0 && (
        <div className="bulk-bar">
          <span><strong>{cSel.count}</strong> cliente(s) selecionado(s)</span>
          <button className="bulk-delete-btn" onClick={() => setCustBulkDeleteConfirm(true)}>
            Excluir selecionados
          </button>
        </div>
      )}

      <Panel title="Clientes cadastrados">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="col-checkbox">
                  <input type="checkbox" checked={cSel.allSelected} onChange={cSel.toggleAll} />
                </th>
                <th className={`sortable ${sCustBy === "name" ? sCustDir : ""}`} onClick={() => sCustSort("name")}>Nome</th>
                <th className={`sortable ${sCustBy === "cidade" ? sCustDir : ""}`} onClick={() => sCustSort("cidade")}>Cidade/UF</th>
                <th className={`sortable ${sCustBy === "orderCount" ? sCustDir : ""}`} onClick={() => sCustSort("orderCount")}>Pedidos</th>
                <th className={`sortable ${sCustBy === "lastPurchase" ? sCustDir : ""}`} onClick={() => sCustSort("lastPurchase")}>Última compra</th>
                <th className={`sortable ${sCustBy === "grossRevenueCents" ? sCustDir : ""}`} onClick={() => sCustSort("grossRevenueCents")}>Receita</th>
                <th className={`sortable ${sCustBy === "profitCents" ? sCustDir : ""}`} onClick={() => sCustSort("profitCents")}>Lucro</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedCust.map((customer) => {
                const daysSinceLast = customer.lastPurchase
                  ? Math.floor((Date.now() - new Date(customer.lastPurchase).getTime()) / 86400000)
                  : Infinity;
                const daysSinceFirst = customer.firstPurchase
                  ? Math.floor((Date.now() - new Date(customer.firstPurchase).getTime()) / 86400000)
                  : Infinity;
                const isInactive = (customer.orderCount ?? 0) > 0 && daysSinceLast > 180;
                const isNew = (customer.orderCount ?? 0) > 0 && daysSinceFirst <= 30 && !isInactive;
                const isRecorrente = (customer.orderCount ?? 0) > 1;
                const isOuro = customer.grossRevenueCents >= vipThreshold && customer.grossRevenueCents > 0;
                return (
                <tr key={customer.id}>
                  <td className="col-checkbox">
                    <input type="checkbox" checked={cSel.selected.has(customer.id)} onChange={() => cSel.toggleOne(customer.id)} />
                  </td>
                  <td>
                    <button type="button" className="link-btn" onClick={() => setViewing(customer)}>{customer.name}</button>
                    {isNew && <span className="tag tag-green">Novo</span>}
                    {isRecorrente && <span className="tag tag-blue">Recorrente ({customer.orderCount})</span>}
                    {isOuro && <span className="tag tag-gold">Ouro</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{[customer.cidade, customer.estado].filter(Boolean).join("/") || "-"}</td>
                  <td style={{ fontSize: 12, textAlign: "center" }}>{customer.orderCount || "-"}</td>
                  <td style={{ fontSize: 12 }}>{customer.lastPurchase ? fmtDate(customer.lastPurchase) : "-"}</td>
                  <td style={{ fontSize: 12 }}>{customer.orderCount ? money(customer.grossRevenueCents) : "-"}</td>
                  <td style={{ fontSize: 12 }}>{customer.orderCount ? money(customer.profitCents) : "-"}</td>
                  <td>
                    <button type="button" className="icon-btn" onClick={() => { setEditing(customer); setModalOpen(true); }} title="Editar">
                      <Pencil size={15} />
                    </button>
                    <button type="button" className="icon-btn icon-btn-danger" onClick={() => handleDelete(customer.id, customer.name)} title="Excluir">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              )})}
              {(customers.data?.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={8}>Sem clientes cadastrados ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={custTotal} onPageChange={setPage} />
      </Panel>

      <ModalShell open={modalOpen} onClose={closeModal} title={editing ? "Editar Cliente" : "Novo Cliente"} asForm onSubmit={submit}>
        <div className="modal-order-main">
              {/* Dados Principais */}
              <div className="order-card">
                <div className="order-card-title">Dados Principais</div>
                <div className="order-grid-3">
                  <div className="order-field" style={{ gridColumn: "span 3" }}>
                    <label>Nome</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" required />
                  </div>
                  <div className={`order-field${docInvalid ? " field-invalid" : ""}${docValid ? " field-valid" : ""}`}>
                    <label>CPF/CNPJ</label>
                    <input
                      value={document}
                      onChange={(e) => handleDocumentChange(e.target.value)}
                      placeholder="000.000.000-00"
                    />
                    {docInvalid && <div className="field-error-text">{documentError}</div>}
                  </div>
                  <div className="order-field">
                    <label>Telefone <span style={{ color: "#aaa" }}>(opcional)</span></label>
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
                  </div>
                  <div className="order-field" style={{ gridColumn: "span 3" }}>
                    <label>E-mail <span style={{ color: "#aaa" }}>(opcional)</span></label>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@email.com" />
                  </div>
                </div>
              </div>

              {/* Endereço */}
              <div className="order-card">
                <div className="order-card-title">Endereço</div>
                <div className="order-grid-3">
                  <div className="order-field">
                    <label>CEP</label>
                    <input
                      value={cep}
                      onChange={(e) => setCep(e.target.value)}
                      onBlur={handleCepBlur}
                      placeholder="00000-000"
                    />
                    {cepLoading && <div className="cep-loading">Buscando CEP...</div>}
                  </div>
                  <div className="order-field">
                    <label>Cidade</label>
                    <input className={cepAutoFilled ? "auto-filled" : ""} value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="São Paulo" />
                  </div>
                  <div className="order-field">
                    <label>Estado</label>
                    <input className={cepAutoFilled ? "auto-filled" : ""} value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="SP" />
                  </div>
                </div>
                <div className="order-grid-3" style={{ marginTop: "12px" }}>
                  <div className="order-field" style={{ gridColumn: "span 2" }}>
                    <label>Logradouro</label>
                    <input className={cepAutoFilled ? "auto-filled" : ""} value={logradouro} onChange={(e) => setLogradouro(e.target.value)} placeholder="Rua, Avenida..." />
                  </div>
                  <div className="order-field">
                    <label>Número</label>
                    <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="123" />
                  </div>
                </div>
                <div className="order-grid-3" style={{ marginTop: "12px" }}>
                  <div className="order-field">
                    <label>Bairro</label>
                    <input className={cepAutoFilled ? "auto-filled" : ""} value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Centro" />
                  </div>
                  <div className="order-field" style={{ gridColumn: "span 2" }}>
                    <label>Complemento</label>
                    <input value={complemento} onChange={(e) => setComplemento(e.target.value)} placeholder="Apto, Bloco..." />
                  </div>
                </div>
              </div>

              {/* Observações */}
              <div className="order-card">
                <details className="order-collapsible">
                  <summary>▶ Observações (opcional)</summary>
                  <textarea
                    placeholder="Informações adicionais sobre o cliente..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </details>
              </div>

              <FormActions onCancel={closeModal} submitLabel={editing ? "Atualizar Cliente" : "Salvar Cliente"} />
          </div>
      </ModalShell>

      {viewing && (
        <CustomerDetailModal
          customer={viewing}
          open
          onClose={closeDetailModal}
          onEdit={handleViewEdit}
          onViewOrder={onViewOrder}
        />
      )}
      <ConfirmDeleteModal
        open={deleteTarget !== null}
        title="Excluir Cliente"
        entityName={deleteTarget?.name ?? ""}
        dependencyEndpoint={deleteTarget ? `/customers/${deleteTarget.id}/summary` : undefined}
        dependencyQueryKey={deleteTarget ? ["customer-summary", deleteTarget.id] : undefined}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDeleteModal
        open={custBulkDeleteConfirm}
        title="Excluir Clientes"
        entityName={`${cSel.count} cliente(s)`}
        onConfirm={() => { if (cSel.count > 0) custBulkDeleteMutation.mutate([...cSel.selected] as number[]); }}
        onCancel={() => setCustBulkDeleteConfirm(false)}
      />
    </>
  );
}

function fmtDate(iso: string) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}/${m}/${y}`;
}

function Orders({ meta, pendingOrderId, onConsumePendingOrder }: { meta: Meta; pendingOrderId?: number | null; onConsumePendingOrder?: () => void }) {
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: ["products-all"], queryFn: () => api<Paginated<Product>>("/products") });
  const customers = useQuery({ queryKey: ["customers-all"], queryFn: () => api<Paginated<Customer>>("/customers") });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const pageSize = 20;
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (filterStatus) params.set("statusId", filterStatus);
  if (filterFrom) params.set("from", filterFrom);
  if (filterTo) params.set("to", filterTo);
  if (filterStore) params.set("storeId", filterStore);
  params.set("limit", String(pageSize));
  params.set("offset", String(page * pageSize));
  const qs = params.toString();
  const orders = useQuery({
    queryKey: ["orders", search, filterStatus, filterFrom, filterTo, filterStore, page],
    queryFn: () => api<OrdersResponse>(`/orders${qs ? `?${qs}` : ""}`)
  });
  const [orderBulkDeleteConfirm, setOrderBulkDeleteConfirm] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number;
    order?: any;
    type?: "revenue" | "result" | "profit";
    rows?: { label: string; value: string; cls?: string }[];
  } | null>(null);

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

  const STATUS_CLASS: Record<number, string> = {
    1: "novo", 2: "producao", 3: "enviado", 4: "entregue", 5: "cancelado", 6: "devolvido"
  };

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
  }));
  const activeOrderList = rawOrderList.filter((o) => o.statusId !== 6);
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

  function setDatePreset(preset: string) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = now.toISOString().slice(0, 10);
    switch (preset) {
      case "today": setFilterFrom(today); setFilterTo(today); break;
      case "7d": { const d = new Date(now); d.setDate(d.getDate() - 7); setFilterFrom(d.toISOString().slice(0, 10)); setFilterTo(today); break; }
      case "30d": { const d = new Date(now); d.setDate(d.getDate() - 30); setFilterFrom(d.toISOString().slice(0, 10)); setFilterTo(today); break; }
      case "month": { const d = new Date(now.getFullYear(), now.getMonth(), 1); setFilterFrom(d.toISOString().slice(0, 10)); setFilterTo(today); break; }
      case "lastmonth": {
        const y = now.getFullYear(), m = now.getMonth();
        const lastMonthStart = new Date(y, m - 1, 1);
        const lastMonthEnd = new Date(y, m, 0);
        setFilterFrom(lastMonthStart.toISOString().slice(0, 10));
        setFilterTo(lastMonthEnd.toISOString().slice(0, 10));
        break;
      }
      case "all": { setFilterFrom(""); setFilterTo(""); break; }
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Header title="Pedidos" />

      {/* KPIs */}
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

      {/* Toolbar */}
      <div className="toolbar">
        <div className="date-filter">
          <button type="button" onClick={() => setDatePreset("today")}>Hoje</button>
          <button type="button" onClick={() => setDatePreset("7d")}>7D</button>
          <button type="button" onClick={() => setDatePreset("30d")}>30D</button>
          <button type="button" onClick={() => setDatePreset("month")}>Mês</button>
          <button type="button" onClick={() => setDatePreset("lastmonth")}>Mês passado</button>
          <button type="button" onClick={() => setDatePreset("all")}>Todo período</button>
          <input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(0); }} style={{ width: 130 }} />
          <span style={{ color: "#888" }}>até</span>
          <input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(0); }} style={{ width: 130 }} />
        </div>
        <select value={filterStore} onChange={(e) => { setFilterStore(e.target.value); setPage(0); }} style={{ maxWidth: 160 }}>
          <option value="">Todas lojas</option>
          {meta.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }} style={{ maxWidth: 130 }}>
          <option value="">Todos status</option>
          {meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          type="search"
          placeholder="Buscar pedidos..."
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
                        className={`status-badge status-${STATUS_CLASS[order.statusId] ?? ""}`}
                        value={order.statusId}
                        onChange={(e) => statusMutation.mutate({ id: order.id, statusId: Number(e.target.value) })}
                      >
                        <option value={order.statusId} disabled>{order.statusName}</option>
                        {statusTransitions.data[order.statusId].map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`status-badge status-${STATUS_CLASS[order.statusId] ?? ""}`}>{order.statusName}</span>
                    )}
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

      {/* Floating tooltip */}
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsType>("/settings") });
  const stores = useQuery({ queryKey: ["stores"], queryFn: () => api<any[]>("/stores") });
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [storeEditing, setStoreEditing] = useState<any>(null);
  const [storeDeleteTarget, setStoreDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [storeName, setStoreName] = useState("");
  const [storeActive, setStoreActive] = useState(true);
  const [storeMessage, setStoreMessage] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [auditPage, setAuditPage] = useState(0);
  const auditPageSize = 50;
  const audit = useQuery({
    queryKey: ["audit-log", auditPage],
    queryFn: () => api<Paginated<AuditLogEntry>>(`/audit-log?limit=${auditPageSize}&offset=${auditPage * auditPageSize}`)
  });

  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: () => api<{ totalFiles: number; totalSizeBytes: number; latestDate: string | null }>("/backups")
  });

  const saveMutation = useMutation({
    mutationFn: (body: unknown) => api("/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  });

  const backupMutation = useMutation({
    mutationFn: () => api("/backups", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    }
  });

  const openingBalance = useQuery({
    queryKey: ["opening-balance"],
    queryFn: () => api<{ openingBalanceCents: number }>("/finance/opening-balance"),
  });
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");
  const openingBalanceMutation = useMutation({
    mutationFn: (body: any) => api("/finance/opening-balance", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opening-balance"] });
    },
  });

  const storeCreateMutation = useMutation({
    mutationFn: (body: unknown) => api("/stores", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stores"] });
      queryClient.invalidateQueries({ queryKey: ["meta"] });
      setStoreMessage("Loja salva com sucesso.");
      closeStoreModal();
    }
  });
  const storeUpdateMutation = useMutation({
    mutationFn: (body: { id: number; name: string; active: boolean }) => api(`/stores/${body.id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stores"] });
      queryClient.invalidateQueries({ queryKey: ["meta"] });
      setStoreMessage("Loja atualizada com sucesso.");
      closeStoreModal();
    }
  });
  const storeDeleteMutation = useDeleteMutation({
    endpoint: "/stores",
    queryKeysToInvalidate: [["stores"], ["meta"]],
    onSuccess: () => {
      setStoreMessage("Loja excluída com sucesso.");
      setStoreDeleteTarget(null);
    },
    onError: (err) => {
      setStoreMessage(err.message);
      setStoreDeleteTarget(null);
    }
  });

  useEffect(() => {
    if (storeEditing) {
      setStoreName(storeEditing.name);
      setStoreActive(storeEditing.active ?? true);
      setStoreModalOpen(true);
    } else {
      setStoreName("");
      setStoreActive(true);
    }
  }, [storeEditing]);

  useEffect(() => {
    if (settings.data) {
      const next: Record<string, string> = {};
      for (const [key, val] of Object.entries(settings.data)) {
        next[key] = val.value;
      }
      setForm(next);
    }
  }, [settings.data]);

  useEffect(() => {
    if (openingBalance.data) {
      setOpeningBalanceInput(fromCents(openingBalance.data.openingBalanceCents));
    }
  }, [openingBalance.data]);

  function openStoreModal() {
    setStoreEditing(null);
    setStoreModalOpen(true);
  }

  function closeStoreModal() {
    setStoreModalOpen(false);
    setStoreEditing(null);
  }

  function submitStore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { name: storeName, active: storeActive };
    if (storeEditing) {
      storeUpdateMutation.mutate({ id: storeEditing.id, ...payload });
    } else {
      storeCreateMutation.mutate(payload);
    }
  }

  function handleStoreDelete(id: number, name: string) {
    setStoreDeleteTarget({ id, name });
  }

  function formatLabel(key: string) {
    return key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function handleSave() {
    const payload: Record<string, { value: string }> = {};
    for (const [key, value] of Object.entries(form)) {
      payload[key] = { value };
    }
    saveMutation.mutate(payload);
  }

  const labels: Record<string, string> = {
    pla_price_per_kg: "Preço do PLA (kg)",
    energy_cost_per_hour: "Custo de energia (hora)",
    machine_value: "Valor da máquina",
    machine_lifespan_hours: "Vida útil da máquina",
    maintenance_factor: "Fator de manutenção",
    error_rate: "Taxa de erro",
    packaging_cost: "Embalagem por pedido"
  };

  const descs: Record<string, string> = {
    pla_price_per_kg: "Valor do filamento PLA por quilo",
    energy_cost_per_hour: "Custo da energia elétrica por hora de impressão",
    machine_value: "Valor de aquisição da impressora 3D",
    machine_lifespan_hours: "Horas estimadas de vida útil da máquina",
    maintenance_factor: "Percentual adicional para manutenção sobre o valor da máquina",
    error_rate: "Percentual de taxa de erro aplicado sobre o subtotal",
    packaging_cost: "Custo de embalagem usado como padrão ao criar ou importar pedidos"
  };

  const fieldTypes: Record<string, string> = {
    pla_price_per_kg: "currency",
    energy_cost_per_hour: "currency",
    machine_value: "currency",
    machine_lifespan_hours: "number",
    maintenance_factor: "percent",
    error_rate: "percent",
    packaging_cost: "currency"
  };

  function displayValue(key: string, raw: string) {
    const type = fieldTypes[key];
    if (type === "currency") return money(Number(raw));
    if (type === "percent") return `${raw}%`;
    return raw;
  }

  function parseValue(key: string, display: string) {
    const type = fieldTypes[key];
    if (type === "currency") return String(toCents(display));
    if (type === "percent") return display.replace("%", "").trim();
    return display;
  }

  return (
    <>
      <Header title="Configurações do Sistema" subtitle="Parâmetros utilizados nos cálculos de custo de produção." />
      <Notification message={storeMessage} onClose={() => setStoreMessage("")} />
      <Panel title="Lojas">
        <div className="toolbar" style={{ marginTop: 0, marginBottom: "12px" }}>
          <button type="button" onClick={openStoreModal}>
            Adicionar loja
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Ativa</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {(stores.data ?? []).map((store) => (
                <tr key={store.id}>
                  <td>{store.name}</td>
                  <td>{store.active ? "Sim" : "Não"}</td>
                  <td>
                    <button type="button" className="icon-btn" onClick={() => setStoreEditing(store)} title="Editar">
                      <Pencil size={15} />
                    </button>
                    <button type="button" className="icon-btn icon-btn-danger" onClick={() => handleStoreDelete(store.id, store.name)} title="Excluir">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {(stores.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={3}>Sem lojas cadastradas ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <Modal title={storeEditing ? "Editar loja" : "Adicionar loja"} open={storeModalOpen} onClose={closeStoreModal}>
        <form className="modal-form" onSubmit={submitStore}>
          <div className="form-grid">
            <input value={storeName} onChange={(event) => setStoreName(event.target.value)} name="name" placeholder="Nome da loja" required />
            <label className="checkbox-row">
              <input type="checkbox" checked={storeActive} onChange={(event) => setStoreActive(event.target.checked)} />
              Ativa
            </label>
          </div>
          <div className="modal-footer">
            <button type="submit">{storeEditing ? "Atualizar loja" : "Salvar loja"}</button>
            <button type="button" className="ghost" onClick={closeStoreModal}>
              Cancelar
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDeleteModal
        open={storeDeleteTarget !== null}
        title="Excluir Loja"
        entityName={storeDeleteTarget?.name ?? ""}
        onConfirm={() => { if (storeDeleteTarget) storeDeleteMutation.mutate(storeDeleteTarget.id); }}
        onCancel={() => setStoreDeleteTarget(null)}
      />
      <Panel title="Parâmetros de Cálculo">
        <div className="settings-grid">
          {settings.data && Object.keys(settings.data).map((key) => (
            <div className="settings-row" key={key}>
              <div>
                <label>{labels[key] ?? formatLabel(key)}</label>
                <div className="settings-desc">{descs[key] ?? ""}</div>
              </div>
              <div className="order-field" style={{ margin: 0 }}>
                <input
                  value={displayValue(key, form[key] ?? "")}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: parseValue(key, e.target.value) }))}
                />
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "16px" }}>
          <button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Salvando..." : saved ? "Salvo!" : "Salvar configurações"}
          </button>
        </div>
      </Panel>
      <Panel title="Saldo inicial">
        <div className="settings-grid">
          <div className="settings-row">
            <div>
              <label>Saldo inicial (R$)</label>
              <div className="settings-desc">Valor em caixa antes do primeiro período de movimentações financeiras.</div>
            </div>
            <div className="order-field" style={{ margin: 0 }}>
              <input
                value={openingBalanceInput}
                onChange={(e) => setOpeningBalanceInput(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>
        </div>
        <div style={{ marginTop: "16px" }}>
          <button type="button" onClick={() => {
            const v = Math.round(Number(openingBalanceInput.replace(/\./g, "").replace(",", ".")) * 100);
            if (!Number.isFinite(v) || v < 0) { alert("Valor inválido"); return; }
            openingBalanceMutation.mutate({ openingBalanceCents: v });
          }} disabled={openingBalanceMutation.isPending}>
            {openingBalanceMutation.isPending ? "Salvando..." : "Salvar saldo inicial"}
          </button>
        </div>
      </Panel>
      <Panel title="Auditoria">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Ação</th>
                <th>Entidade</th>
                <th>ID</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data?.data ?? []).map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.created_at}</td>
                  <td>{entry.action}</td>
                  <td>{entry.entity}</td>
                  <td>{entry.entity_id ?? "-"}</td>
                  <td>{entry.description}</td>
                </tr>
              ))}
              {(audit.data?.data ?? []).length === 0 && (
                <tr><td colSpan={5}>Nenhum registro ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={auditPage} pageSize={auditPageSize} total={audit.data?.total ?? 0} onPageChange={setAuditPage} itemLabel="registros" />
      </Panel>
      <Panel title="Backup">
        <div className="backup-row">
          <button onClick={() => backupMutation.mutate()} disabled={backupMutation.isPending}>
            <DatabaseBackup size={18} />
            {backupMutation.isPending ? "Salvando..." : "Fazer backup agora"}
          </button>
          <span>
            {backups.data
              ? `Último: ${backups.data.latestDate ?? "—"} · ${backups.data.totalFiles} arquivo${backups.data.totalFiles !== 1 ? "s" : ""} · ${formatBytes(backups.data.totalSizeBytes)}`
              : "Carregando..."}
          </span>
        </div>
        <div className="backup-auto" style={{ fontSize: 13, color: "#888", marginTop: 8 }}>
          Automático: diário (1 backup por dia, retenção: 30 dias + 1 por mês)
        </div>
      </Panel>
    </>
  );
}
