import { useState, useMemo, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Product, type Settings, money, toCents, fromCents } from "./api";
import { ModalShell } from "./ModalShell";
import { FormActions } from "./FormActions";

type CalculationInputs = {
  weightGrams: number;
  printTimeMinutes: number;
  additionalCostCents: number;
  settings: Settings | null;
};

function calcProductionCost(inputs: CalculationInputs) {
  const s = inputs.settings;
  if (!s) return null;

  const plaPricePerKgCents = Number(s.pla_price_per_kg?.value ?? 10000);
  const energyCostPerHourCents = Number(s.energy_cost_per_hour?.value ?? 10);
  const machineValueCents = Number(s.machine_value?.value ?? 800000);
  const machineLifespanHours = Number(s.machine_lifespan_hours?.value ?? 3000);
  const maintenanceFactor = Number(s.maintenance_factor?.value ?? 10);
  const errorRate = Number(s.error_rate?.value ?? 10);

  const materialCents = Math.round((inputs.weightGrams / 1000) * plaPricePerKgCents);
  const energyCents = Math.round(inputs.printTimeMinutes * (energyCostPerHourCents / 60));
  const machineHourCost = (machineValueCents / machineLifespanHours / 60) * (1 + maintenanceFactor / 100);
  const machineCents = Math.round(inputs.printTimeMinutes * machineHourCost);
  const subtotalCents = materialCents + energyCents + machineCents + inputs.additionalCostCents;
  const errorCents = Math.round(subtotalCents * (errorRate / 100));
  const totalCents = subtotalCents + errorCents;

  return {
    materialCents,
    energyCents,
    machineCents,
    additionalCents: inputs.additionalCostCents,
    subtotalCents,
    errorCents,
    totalCents,
    errorRate
  };
}

type Props = {
  settings: Settings | null;
  editing: Product | null;
  open: boolean;
  onClose: () => void;
  initialSku?: string;
  initialName?: string;
};

export function ProductModal({ settings, editing, open, onClose, initialSku, initialName }: Props) {
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [active, setActive] = useState(true);
  const [weightGrams, setWeightGrams] = useState("");
  const [printTimeMinutes, setPrintTimeMinutes] = useState("");
  const [additionalCost, setAdditionalCost] = useState("");
  const [recalculate, setRecalculate] = useState<"none" | "from_date" | "all">("none");
  const [recalculateFrom, setRecalculateFrom] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setSku(editing.sku);
      setActive(editing.active);
      setWeightGrams(String(editing.weightGrams || ""));
      setPrintTimeMinutes(String(editing.printTimeMinutes || ""));
      setAdditionalCost(fromCents(editing.additionalCostCents));
    } else {
      setName(initialName || "");
      setSku(initialSku || "");
      setActive(true);
      setWeightGrams("");
      setPrintTimeMinutes("");
      setAdditionalCost("");
    }
    setRecalculate("none");
    setRecalculateFrom(new Date().toISOString().slice(0, 10));
  }, [open, editing, initialSku, initialName]);

  const weightG = Number(weightGrams) || 0;
  const printMin = Number(printTimeMinutes) || 0;
  const addCents = toCents(additionalCost);

  const calc = useMemo(
    () => calcProductionCost({ weightGrams: weightG, printTimeMinutes: printMin, additionalCostCents: addCents, settings }),
    [weightG, printMin, addCents, settings]
  );

  const createMutation = useMutation({
    mutationFn: (body: unknown) => api("/products", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onClose();
    }
  });

  const updateMutation = useMutation({
    mutationFn: (body: unknown) => api(`/products/${editing!.id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onClose();
    }
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const totalCost = calc?.totalCents ?? 0;
    const payload = {
      name,
      sku,
      currentCostCents: totalCost,
      weightGrams: weightG,
      printTimeMinutes: printMin,
      additionalCostCents: addCents,
      active
    };
    if (editing) {
      updateMutation.mutate({ ...payload, recalculate, recalculateFrom });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title={editing ? "Editar Produto" : "Novo Produto"} asForm onSubmit={submit}>
          <div className="modal-order-main">
            {/* Section 1: General Data */}
            <div className="order-card">
              <div className="order-card-title">Dados Gerais</div>
              <div className="order-grid-3">
                <div className="order-field" style={{ gridColumn: "span 2" }}>
                  <label>Nome do produto</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Porta-retrato 10x15" required />
                </div>
                <div className="order-field">
                  <label>SKU</label>
                  <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ex: V3D-001" required />
                </div>
              </div>
              <div className="order-field" style={{ maxWidth: "200px" }}>
                <label>Status</label>
                <select value={active ? "active" : "inactive"} onChange={(e) => setActive(e.target.value === "active")}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </div>
            </div>

            {/* Section 2: Production Data */}
            <div className="order-card">
              <div className="order-card-title">Dados de Produção</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="order-field">
                    <label>Peso (gramas)</label>
                    <input
                      type="number" min="0"
                      value={weightGrams}
                      onChange={(e) => setWeightGrams(e.target.value)}
                      placeholder="Ex: 120"
                    />
                  </div>
                  <div className="calc-field">
                    <span className="calc-label">Custo do material</span>
                    <span className="calc-value">{calc ? money(calc.materialCents) : "—"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="order-field">
                    <label>Tempo de impressão (minutos)</label>
                    <input
                      type="number" min="0"
                      value={printTimeMinutes}
                      onChange={(e) => setPrintTimeMinutes(e.target.value)}
                      placeholder="Ex: 240"
                    />
                  </div>
                  <div className="calc-field">
                    <span className="calc-label">Custo de energia</span>
                    <span className="calc-value">{calc ? money(calc.energyCents) : "—"}</span>
                  </div>
                  <div className="calc-field">
                    <span className="calc-label">Máquina + manutenção</span>
                    <span className="calc-value">{calc ? money(calc.machineCents) : "—"}</span>
                  </div>
                </div>
                <div className="order-field" style={{ alignSelf: "start" }}>
                  <label>Custos adicionais</label>
                  <input
                    value={additionalCost}
                    onChange={(e) => setAdditionalCost(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
              </div>
            </div>

            {/* Recalculate existing orders (editing only) */}
            {editing && (
              <div className="order-card">
                <div className="order-card-title">Atualizar custo em pedidos existentes</div>
                <div className="recalc-options">
                  <label className={`recalc-option${recalculate === "none" ? " selected" : ""}`}>
                    <input type="radio" name="recalc" value="none" checked={recalculate === "none"} onChange={() => setRecalculate("none")} />
                    <div className="recalc-content">
                      <div className="recalc-title">Não alterar pedidos retroativos</div>
                      <div className="recalc-desc">Mantém os custos antigos como estão.</div>
                    </div>
                  </label>
                  <label className={`recalc-option${recalculate === "from_date" ? " selected" : ""}`}>
                    <input type="radio" name="recalc" value="from_date" checked={recalculate === "from_date"} onChange={() => setRecalculate("from_date")} />
                    <div className="recalc-content">
                      <div className="recalc-title">Alterar a partir de uma data</div>
                      <div className="recalc-desc">Atualiza apenas pedidos a partir da data escolhida.</div>
                      <input
                        type="date"
                        value={recalculateFrom}
                        onChange={(e) => { setRecalculate("from_date"); setRecalculateFrom(e.target.value); }}
                        onClick={(e) => e.stopPropagation()}
                        className="recalc-date"
                      />
                    </div>
                  </label>
                  <label className={`recalc-option${recalculate === "all" ? " selected" : ""}`}>
                    <input type="radio" name="recalc" value="all" checked={recalculate === "all"} onChange={() => setRecalculate("all")} />
                    <div className="recalc-content">
                      <div className="recalc-title">Alterar todos os pedidos</div>
                      <div className="recalc-desc">Recalcula o custo de todos os pedidos com este produto.</div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            <FormActions onCancel={onClose} submitLabel={editing ? "Atualizar Produto" : "Salvar Produto"} />
          </div>

          {/* RIGHT: Cost Summary */}
          <div className="modal-order-sidebar">
            <div className="sidebar-section">
              <div className="sidebar-label">Resumo de Custos</div>
              <div className="sidebar-row">
                <span>Material</span>
                <span className="val">{calc ? money(calc.materialCents) : "—"}</span>
              </div>
              <div className="sidebar-row">
                <span>Energia</span>
                <span className="val">{calc ? money(calc.energyCents) : "—"}</span>
              </div>
              <div className="sidebar-row">
                <span>Máquina + manutenção</span>
                <span className="val">{calc ? money(calc.machineCents) : "—"}</span>
              </div>
              <div className="sidebar-row">
                <span>Adicionais</span>
                <span className="val">{calc ? money(calc.additionalCents) : "—"}</span>
              </div>
              <div className="sidebar-divider"></div>
              <div className="sidebar-row">
                <span>Subtotal</span>
                <span className="val">{calc ? money(calc.subtotalCents) : "—"}</span>
              </div>
              <div className="sidebar-row">
                <span>Taxa de erro ({calc?.errorRate ?? 10}%)</span>
                <span className="val">{calc ? money(calc.errorCents) : "—"}</span>
              </div>
              <div className="sidebar-divider"></div>
              <div className="sidebar-total">
                <span>Custo Total</span>
                <span>{calc ? money(calc.totalCents) : "—"}</span>
              </div>
            </div>

            <div className="profit-block"
              style={{
                background: calc?.totalCents
                  ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                  : "linear-gradient(135deg, #94a3b8, #cbd5e1)"
              }}>
              <div className="profit-label">Custo de Produção</div>
              <div className="profit-amount">{calc ? money(calc.totalCents) : "—"}</div>
              <div className="profit-margin">Por unidade</div>
            </div>
          </div>
    </ModalShell>
  );
}
