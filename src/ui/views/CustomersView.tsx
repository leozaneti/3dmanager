import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { api, money, fmtDate, Customer, Paginated } from "../api";
import { calculateOrderTotals } from "../../../server/calculations";
import { PageHeader } from "../PageHeader";
import { Panel } from "../Panel";
import { Pagination } from "../Pagination";
import { Notification } from "../Notification";
import { ModalShell } from "../ModalShell";
import { FormActions } from "../FormActions";
import { ConfirmDeleteModal } from "../ConfirmDeleteModal";
import { CustomerDetailModal } from "../CustomerDetailModal";
import { OrderDetailModal } from "../OrderDetailModal";
import { KpiCard } from "../KpiCard";
import { DatePresetBar, type DatePreset } from "../DatePresetBar";
import { dateRangeFor } from "../../hooks/useDatePresets";
import { useDeleteMutation } from "../../hooks/useDeleteMutation";
import { useSelection } from "../../hooks/useSelection";
import { useSort } from "../../hooks/useSort";
import { cleanDigits, validateDocument } from "../utils/validators";
import { STATES } from "../../shared/brazilianStates";

export function CustomersView({ onEditOrder }: { onEditOrder?: (orderId: number) => void }) {
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
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
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

  function setCustomerDatePreset(preset: DatePreset) {
    const { startDate, endDate, allTime } = dateRangeFor(preset);
    setStartDate(startDate);
    setEndDate(endDate);
    setAllTime(allTime);
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
      const kpis = (c.orderCount ?? 0) > 0 ? calculateOrderTotals({
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
      { prod: 0, shipCust: 0, shipTot: 0, shipTot2: 0, fees: 0, disc: 0, other: 0, items: 0, pkg: 0, add: 0 } as Record<string, number>
    );
    return {
      ...calculateOrderTotals({
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

  const { sorted: sortedCust, sortBy: sCustBy, sortDir: sCustDir, handleSort: sCustSort } = useSort(customerKpis, "name");
  const cSel = useSelection(custList);

  return (
    <>
      <PageHeader title="Clientes" subtitle="Cadastro de compradores com endereço." />
      <section className="kpi-section">
        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiCard label="Total" value={custTotal} />
          <KpiCard label="Receita total" value={money(globalKpis.grossRevenueCents)} />
          <KpiCard label="Lucro total" value={money(globalKpis.profitCents)} />
        </div>
      </section>
      <div className="toolbar">
        <DatePresetBar
          activePreset={
            !allTime && startDate === todayStr && endDate === todayStr ? "today" : undefined
          }
          isAllTime={allTime}
          onPresetChange={setCustomerDatePreset}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={(v) => { setStartDate(v); setAllTime(false); setPage(0); }}
          onEndDateChange={(v) => { setEndDate(v); setAllTime(false); setPage(0); }}
        />
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
          {STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
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
          onViewOrder={(id: number) => setDetailOrderId(id)}
        />
      )}
      {detailOrderId && (
        <OrderDetailModal
          orderId={detailOrderId}
          open={detailOrderId !== null}
          onClose={() => setDetailOrderId(null)}
          onEdit={(id) => { setDetailOrderId(null); onEditOrder?.(id); }}
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
