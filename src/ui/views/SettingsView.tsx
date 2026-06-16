import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, Pencil, Trash2 } from "lucide-react";
import { api, fromCents, money, toCents, AuditLogEntry, Paginated, type Settings as SettingsType } from "../api";
import { PageHeader } from "../PageHeader";
import { Panel } from "../Panel";
import { Pagination } from "../Pagination";
import { Notification } from "../Notification";
import { ModalShell } from "../ModalShell";
import { ConfirmDeleteModal } from "../ConfirmDeleteModal";
import { useDeleteMutation } from "../../hooks/useDeleteMutation";
import { formatBytes } from "../utils/format";

const LABELS: Record<string, string> = {
  pla_price_per_kg: "Preço do PLA (kg)",
  energy_cost_per_hour: "Custo de energia (hora)",
  machine_value: "Valor da máquina",
  machine_lifespan_hours: "Vida útil da máquina",
  maintenance_factor: "Fator de manutenção",
  error_rate: "Taxa de erro",
  packaging_cost: "Embalagem por pedido"
};

const DESCS: Record<string, string> = {
  pla_price_per_kg: "Valor do filamento PLA por quilo",
  energy_cost_per_hour: "Custo da energia elétrica por hora de impressão",
  machine_value: "Valor de aquisição da impressora 3D",
  machine_lifespan_hours: "Horas estimadas de vida útil da máquina",
  maintenance_factor: "Percentual adicional para manutenção sobre o valor da máquina",
  error_rate: "Percentual de taxa de erro aplicado sobre o subtotal",
  packaging_cost: "Custo de embalagem usado como padrão ao criar ou importar pedidos"
};

const FIELD_TYPES: Record<string, "currency" | "number" | "percent" | "text"> = {
  pla_price_per_kg: "currency",
  energy_cost_per_hour: "currency",
  machine_value: "currency",
  machine_lifespan_hours: "number",
  maintenance_factor: "percent",
  error_rate: "percent",
  packaging_cost: "currency"
};

function formatLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayValue(key: string, raw: string) {
  const type = FIELD_TYPES[key];
  if (type === "currency") return money(Number(raw));
  if (type === "percent") return `${raw}%`;
  return raw;
}

function parseValue(key: string, display: string) {
  const type = FIELD_TYPES[key];
  if (type === "currency") return String(toCents(display));
  if (type === "percent") return display.replace("%", "").trim();
  return display;
}

export function SettingsView() {
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

  function handleSave() {
    const payload: Record<string, { value: string }> = {};
    for (const [key, value] of Object.entries(form)) {
      payload[key] = { value };
    }
    saveMutation.mutate(payload);
  }

  return (
    <>
      <PageHeader title="Configurações do Sistema" subtitle="Parâmetros utilizados nos cálculos de custo de produção." />
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
      <ModalShell title={storeEditing ? "Editar loja" : "Adicionar loja"} open={storeModalOpen} onClose={closeStoreModal} asForm onSubmit={submitStore} maxWidth="480px">
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
      </ModalShell>
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
                <label>{LABELS[key] ?? formatLabel(key)}</label>
                <div className="settings-desc">{DESCS[key] ?? ""}</div>
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
