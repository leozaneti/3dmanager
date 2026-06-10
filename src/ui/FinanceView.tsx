import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { api, money, fromCents } from "./api";
import { ModalShell } from "./ModalShell";
import { FormActions } from "./FormActions";
import { Pagination } from "./Pagination";
import { OrderDetailModal } from "./OrderDetailModal";

const ACCOUNT_OPTIONS = [
  "Mercado Pago", "Nubank", "Itaú", "Caixa", "Bradesco",
  "Santander", "Inter", "PicPay", "Dinheiro", "Outra"
];

const PAGE_SIZE = 25;

function fmtDate(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("pt-BR");
}

function useSort<T>(data: T[], defaultSort: string) {
  const [sortBy, setSortBy] = useState(defaultSort);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const handleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("asc"); }
  };
  const sorted = [...data].sort((a: any, b: any) => {
    const av = a[sortBy], bv = b[sortBy];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number") return sortDir === "asc" ? av - bv : bv - av;
    return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
  return { sorted, sortBy, sortDir, handleSort };
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {sub && <span className="kpi-sub">{sub}</span>}
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

export function FinanceView({ onEditOrder }: { onEditOrder?: (orderId: number) => void }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [filterType, setFilterType] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCostType, setFilterCostType] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [page, setPage] = useState(0);

  function setPreset(label: string) {
    const now = new Date();
    if (label === "Hoje") { setStartDate(today); setEndDate(today); }
    else if (label === "7D") { const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); setStartDate(d.toISOString().split("T")[0]); setEndDate(today); }
    else if (label === "30D") { setStartDate(thirtyDaysAgo); setEndDate(today); }
    else if (label === "Este mês") { setStartDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]); setEndDate(today); }
    else if (label === "Todo período") { setStartDate(""); setEndDate(""); }
    setPage(0);
  }

  const qs = new URLSearchParams();
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);
  if (filterType) qs.set("type", filterType);
  if (filterCategory) qs.set("category", filterCategory);
  if (filterCostType) qs.set("costType", filterCostType);
  if (filterSearch) qs.set("q", filterSearch);
  qs.set("limit", String(PAGE_SIZE));
  qs.set("offset", String(page * PAGE_SIZE));
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

  const dreWarnings = d?.warnings ?? { discrepantOrders: [], totalDiscrepancyCents: 0, totalDiscrepancyOrders: 0 };

  function calcDreRow(real: Record<string, number>, pend: Record<string, number>) {
    const revenue = (real.revenueCents ?? 0) + (pend.revenueCents ?? 0);
    const prodCost = (real.itemsCostCents ?? 0) + (pend.itemsCostCents ?? 0);
    const pack = (real.packagingCents ?? 0) + (pend.packagingCents ?? 0);
    const addCosts = (real.additionalCostsCents ?? 0) + (pend.additionalCostsCents ?? 0);

    const realContrib = (real.revenueCents ?? 0) - (real.itemsCostCents ?? 0) - (real.packagingCents ?? 0) - (real.additionalCostsCents ?? 0) - txVar.total;
    const pendContrib = (pend.revenueCents ?? 0) - (pend.itemsCostCents ?? 0) - (pend.packagingCents ?? 0) - (pend.additionalCostsCents ?? 0);
    const contribution = realContrib + pendContrib;

    const realNetResult = realContrib - txFix.total + txOther.total;
    const pendNetResult = pendContrib;
    const netResult = realNetResult + pendNetResult;

    const pct = (v: number) => revenue > 0 ? ((v / revenue) * 100).toFixed(1) : "0.0";

    return {
      rows: [
        { label: "Receita de vendas", pct: pct(revenue), realized: real.revenueCents ?? 0, pending: pend.revenueCents ?? 0, cls: "finance-dre-section" },
        { label: "(-) Custo dos produtos", pct: pct(-prodCost), realized: -(real.itemsCostCents ?? 0), pending: -(pend.itemsCostCents ?? 0), cls: "finance-dre-negative" },
        { label: "(-) Embalagens", pct: pct(-pack), realized: -(real.packagingCents ?? 0), pending: -(pend.packagingCents ?? 0), cls: "finance-dre-negative" },
        { label: "(-) Custos adicionais da venda", pct: pct(-addCosts), realized: -(real.additionalCostsCents ?? 0), pending: -(pend.additionalCostsCents ?? 0), cls: "finance-dre-negative" },
        { label: "(-) Despesas variáveis", pct: pct(-txVar.total), realized: -txVar.total, pending: 0, cls: "finance-dre-negative" },
        { label: "MARGEM DE CONTRIBUIÇÃO", pct: pct(contribution), realized: realContrib, pending: pendContrib, cls: "finance-dre-result", borderTop: true },
        { label: "(-) Despesas fixas", pct: pct(-txFix.total), realized: -txFix.total, pending: 0, cls: "finance-dre-negative" },
        { label: "(+) Outras receitas", pct: pct(txOther.total), realized: txOther.total, pending: 0, cls: "finance-dre-positive" },
        { label: "RESULTADO LÍQUIDO", pct: pct(netResult), realized: realNetResult, pending: pendNetResult, cls: "finance-dre-result" },
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
  const [txAccount, setTxAccount] = useState("");
  const [txCustomAccount, setTxCustomAccount] = useState("");
  const [txExternalTxNumber, setTxExternalTxNumber] = useState("");
  const [descSearch, setDescSearch] = useState("");
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [descOpen, setDescOpen] = useState(false);

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

  const descAutocomplete = useQuery({
    queryKey: ["tx-descriptions", descSearch],
    queryFn: () => api<{ data: string[] }>(`/transactions/descriptions?q=${encodeURIComponent(descSearch)}`),
    enabled: descSearch.length > 0,
  });

  const { sorted: sortedTxs, sortBy: sTxBy, sortDir: sTxDir, handleSort: sTxSort } = useSort(transactions.data?.data ?? [], "date");

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
    setTxAccount(tx.account || "");
    setTxCustomAccount("");
    setTxExternalTxNumber(tx.externalTransactionNumber || "");
    setModalOpen(true);
  }

  function resetForm() {
    setTxType("income"); setTxCategory("Vendas"); setTxDate(today);
    setTxDescription(""); setTxAmount(""); setTxCostType("variable"); setTxOrderIds([]); setOrderSearch("");
    setTxAccount(""); setTxCustomAccount(""); setTxExternalTxNumber("");
    setEditingTx(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = hasAutoCalc
      ? autoAmountCents
      : Math.round(Number((txAmount ?? "0").replace(/\./g, "").replace(",", ".")) * 100);
    const account = txAccount === "Outra" ? txCustomAccount : txAccount;
    const body = {
      date: txDate, type: txType, category: txCategory, description: txDescription,
      amountCents,
      costType: txType === "expense" ? txCostType : null,
      orderIds: txOrderIds,
      account: account || null,
      externalTransactionNumber: txExternalTxNumber || null,
    };
    saveMutation.mutate({ id: editingTx?.id, body });
  }

  const totalTx = transactions.data?.total ?? 0;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Financeiro</h1>
          <p>Fluxo de caixa: entradas, saídas e resultado do período.</p>
        </div>
      </header>

      <section className="kpi-section">
        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiCard label="Saldo atual" value={money(balanceCents)} sub="Saldo inicial + movimentações" />
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
        <input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Buscar descrição, pedido, cliente..." style={{ minWidth: 200 }} />
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
                <th className={`sortable ${sTxBy === "date" ? sTxDir : ""}`} onClick={() => sTxSort("date")}>Data</th>
                <th className={`sortable ${sTxBy === "description" ? sTxDir : ""}`} onClick={() => sTxSort("description")}>Descrição</th>
                <th className={`sortable ${sTxBy === "category" ? sTxDir : ""}`} onClick={() => sTxSort("category")}>Categoria</th>
                <th className={`sortable ${sTxBy === "account" ? sTxDir : ""}`} onClick={() => sTxSort("account")} style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11 }}>Conta</th>
                <th className={`sortable ${sTxBy === "externalTransactionNumber" ? sTxDir : ""}`} onClick={() => sTxSort("externalTransactionNumber")} style={{ maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11 }}>Nº externo</th>
                <th className={`sortable ${sTxBy === "costType" ? sTxDir : ""}`} onClick={() => sTxSort("costType")} style={{ fontSize: 11 }}>Classificação</th>
                <th style={{ fontSize: 11 }}>Pedidos</th>
                <th className={`sortable ${sTxBy === "amountCents" ? sTxDir : ""}`} onClick={() => sTxSort("amountCents")} style={{ textAlign: "right" }}>Valor</th>
                <th style={{ width: 60 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedTxs.map((t: any) => (
                <tr key={t.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(t.date)}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <strong style={{ display: "block", fontSize: 13 }}>{t.description}</strong>
                    <span style={{ color: "#888", fontSize: 12 }}>{t.type === "income" ? "Entrada" : "Saída"}</span>
                  </td>
                  <td><span className={`tag ${t.type === "income" ? "tag-green" : "tag-red"}`}>{t.category}</span></td>
                  <td style={{ fontSize: 12, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.account || <span style={{ color: "#999" }}>-</span>}</td>
                  <td style={{ fontSize: 11, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.externalTransactionNumber || <span style={{ color: "#999" }}>-</span>}</td>
                  <td>
                    {t.type === "expense" ? (
                      <span className={`tag ${t.costType === "fixed" ? "tag-blue" : "tag-gold"}`}>
                        {t.costType === "fixed" ? "Fixo" : "Variável"}
                      </span>
                    ) : <span style={{ color: "#ccc", fontSize: 11 }}>—</span>}
                  </td>
                  <td>
                    {t.orders?.length ? (
                      <span className="finance-order-badge" onClick={() => setDetailOrderId(t.orders[0]?.id)} style={{ cursor: "pointer" }}>
                        {t.orders.length} pedido{t.orders.length > 1 ? "s" : ""}
                      </span>
                    ) : <span style={{ color: "#ccc", fontSize: 11 }}>—</span>}
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
        <Pagination page={page} pageSize={PAGE_SIZE} total={totalTx} onPageChange={setPage} itemLabel="movimentações" />
      </Panel>

      {dreWarnings.totalDiscrepancyOrders > 0 && (
        <Panel title="⚠️ Divergências detectadas">
          <div className="alert warning" style={{ margin: 0 }}>
            <span>
              {dreWarnings.totalDiscrepancyOrders} pedido(s) com divergência entre valor recebido × esperado.
              {dreWarnings.discrepantOrders.slice(0, 5).map((w: any) => (
                <div key={w.orderId} style={{ fontSize: "0.85em", marginTop: 4 }}>
                  Pedido <button type="button" className="link-btn" onClick={() => setFilterSearch(String(w.orderId))} style={{ fontSize: "0.85em" }}>#{w.orderId}</button>
                  {w.externalId ? <span> (<button type="button" className="link-btn" onClick={() => setFilterSearch(w.externalId)} style={{ fontSize: "0.85em" }}>{w.externalId.slice(-8)}</button>)</span> : ""}:
                  recebido <strong>{money(w.receivedCents)}</strong> × esperado <strong>{money(w.expectedCents)}</strong>
                  {" "}({w.diffCents > 0 ? "+" : ""}{money(Math.abs(w.diffCents))})
                </div>
              ))}
              {dreWarnings.discrepantOrders.length > 5 && (
                <div style={{ fontSize: "0.85em", marginTop: 4, color: "#92400e" }}>
                  +{dreWarnings.discrepantOrders.length - 5} outro(s)
                </div>
              )}
            </span>
          </div>
        </Panel>
      )}

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
                <input value={txDescription}
                       onChange={(e) => { setTxDescription(e.target.value); setDescSearch(e.target.value); }}
                       onFocus={() => setDescOpen(true)}
                       onBlur={() => setTimeout(() => setDescOpen(false), 200)}
                       placeholder="Descrição da movimentação"
                       list="tx-descriptions" />
                <datalist id="tx-descriptions">
                  {(descAutocomplete.data?.data ?? []).map((d: string) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div className="order-field">
                <label>Conta</label>
                <select value={txAccount} onChange={(e) => setTxAccount(e.target.value)}>
                  <option value="">Selecionar conta</option>
                  {ACCOUNT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                {txAccount === "Outra" && (
                  <input value={txCustomAccount} onChange={(e) => setTxCustomAccount(e.target.value)} placeholder="Digite a conta" style={{ marginTop: 4 }} />
                )}
              </div>
              <div className="order-field">
                <label>Nº transação externo</label>
                <input value={txExternalTxNumber} onChange={(e) => setTxExternalTxNumber(e.target.value)} placeholder="ID externo" />
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

      {detailOrderId && (
        <OrderDetailModal
          orderId={detailOrderId}
          open={detailOrderId !== null}
          onClose={() => setDetailOrderId(null)}
          onEdit={(id) => { setDetailOrderId(null); onEditOrder?.(id); }}
        />
      )}
    </>
  );
}
