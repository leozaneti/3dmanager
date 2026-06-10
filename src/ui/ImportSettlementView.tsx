import React, { useRef, useState } from "react";
import {
  Upload, CheckCircle2, XCircle, FileWarning, Loader2,
  FileSpreadsheet, BadgeCheck, Wallet, RotateCcw
} from "lucide-react";
import { money } from "./api";

type ImportStatus = "idle" | "preview" | "importing" | "done" | "error";

interface MpPreviewRow {
  key: string;
  date: string;
  type: "income" | "expense";
  category: string;
  description: string;
  amountCents: number;
  orderId: number | null;
  orderExternalId: string | null;
  status: "new" | "duplicate" | "no_match";
  skipped: boolean;
}

interface MpPreviewWarning {
  orderId: number;
  externalId: string;
  receivedCents: number;
  expectedCents: number;
  diffCents: number;
}

interface MpPreviewData {
  token: string;
  rows: MpPreviewRow[];
  summary: {
    total: number;
    income: number;
    expense: number;
    duplicated: number;
    linked: number;
    noMatch: number;
    skipped: number;
  };
  warnings: MpPreviewWarning[];
}

interface MpImportResult {
  imported: number;
  duplicated: number;
  errors: { line: number; message: string }[];
}

async function apiDirect<T>(path: string, body: FormData | object): Promise<T> {
  const isFormData = body instanceof FormData;
  const response = await fetch(`http://127.0.0.1:3333/api${path}`, {
    method: "POST",
    headers: isFormData ? {} : { "Content-Type": "application/json" },
    body: isFormData ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Erro na importação");
  }
  return response.json() as Promise<T>;
}

export function ImportSettlementView() {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [preview, setPreview] = useState<MpPreviewData | null>(null);
  const [result, setResult] = useState<MpImportResult | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (f: File | null) => {
    setFile(f);
    setStatus("idle");
    setPreview(null);
    setResult(null);
    setError("");
    setSelectedKeys(new Set());
    if (!f) { setFileName(""); setFileSize(0); return; }
    setFileName(f.name);
    setFileSize(f.size);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files?.[0] ?? null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f || !f.name.endsWith(".csv")) {
      setError("Formato não suportado. Use .csv do Mercado Pago");
      return;
    }
    handleFileSelect(f);
  };

  const parseLocal = async () => {
    if (!file) return;
    setStatus("preview");
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const data = await apiDirect<MpPreviewData>("/imports/mp/preview", formData);
      setPreview(data);
      setSelectedKeys(new Set(data.rows.filter(r => !r.skipped && r.status !== "duplicate").map(r => r.key)));
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  };

  const runImport = async () => {
    if (!preview) return;
    setStatus("importing");
    setError("");
    try {
      const res = await apiDirect<MpImportResult>("/imports/mp/confirm", {
        token: preview.token,
        selectedKeys: [...selectedKeys],
      });
      setResult(res);
      setStatus("done");
      setMessage(`${res.imported} transações importadas com sucesso.`);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  };

  const reset = () => {
    setFile(null);
    setFileName("");
    setFileSize(0);
    setStatus("idle");
    setPreview(null);
    setResult(null);
    setError("");
    setSelectedKeys(new Set());
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const toggleAll = () => {
    if (!preview) return;
    const selectable = preview.rows.filter(r => !r.skipped && r.status !== "duplicate");
    if (selectedKeys.size === selectable.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(selectable.map(r => r.key)));
    }
  };

  const toggleOne = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const stepClass = (step: number) => {
    if (status === "error" && step === 2) return "active";
    if (status === "idle" && step === 1) return "active";
    const order = ["idle", "preview", "importing", "done", "error"];
    const idx = order.indexOf(status);
    if (step <= idx) return "done";
    if (step === idx + 1) return "active";
    return "";
  };

  const stepIcon = (step: number) => {
    const cls = stepClass(step);
    if (cls === "done" && !(status === "error" && step === 2)) return <CheckCircle2 size={14} />;
    if (status === "error" && step === 2) return <XCircle size={14} />;
    return step;
  };

  const selectable = preview ? preview.rows.filter(r => !r.skipped && r.status !== "duplicate") : [];
  const anySelected = selectedKeys.size > 0;

  return (
    <div className="import-view">
      {/* Stepper */}
      <div className="import-stepper">
        <div className={`import-step ${stepClass(1)}`}>
          <div className="import-step-number">{stepIcon(1)}</div>
          <span>Upload</span>
        </div>
        <div className={`import-step-line ${stepClass(2) ? "done" : ""}`} />
        <div className={`import-step ${stepClass(2)}`}>
          <div className="import-step-number">{stepIcon(2)}</div>
          <span>Revisão</span>
        </div>
        <div className={`import-step-line ${stepClass(3) ? "done" : ""}`} />
        <div className={`import-step ${stepClass(3)}`}>
          <div className="import-step-number">{stepIcon(3)}</div>
          <span>Resultado</span>
        </div>
      </div>

      {/* Drop Zone */}
      <div className="import-card">
        <div
          className={`import-drop${dragOver ? " drag-over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <FileSpreadsheet size={36} />
          <strong>{fileName || "Clique ou arraste o CSV aqui"}</strong>
          {fileName && <span>{(fileSize / 1024).toFixed(1)} KB</span>}
          {fileName?.endsWith(".csv") && (
            <span style={{ color: "#059669", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <BadgeCheck size={16} /> Arquivo CSV reconhecido
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={handleInputChange}
          hidden
        />
      </div>

      {/* Error alert */}
      {error && (
        <div className="alert error">
          <XCircle size={18} /> {error}
        </div>
      )}

      {/* Message */}
      {message && (
        <div className="alert success" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle2 size={18} /> {message}
        </div>
      )}

      {/* Preview button */}
      {status === "idle" && file && (
        <div className="form-row">
          <button className="btn primary" onClick={parseLocal}>
            <Upload size={16} /> Visualizar prévia
          </button>
          <button className="btn" onClick={reset}>Cancelar</button>
        </div>
      )}

      {/* Preview */}
      {status === "preview" && preview && (
        <div className="preview">
          {/* Summary cards */}
          <div className="import-cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
            <div className="import-card-item" style={{ borderColor: "#059669" }}>
              <Wallet size={18} />
              <div className="import-card-value">{money(preview.summary.income)}</div>
              <div className="import-card-label">Receitas</div>
            </div>
            {preview.summary.expense > 0 && (
              <div className="import-card-item" style={{ borderColor: "#dc2626" }}>
                <RotateCcw size={18} />
                <div className="import-card-value" style={{ color: "#dc2626" }}>{money(preview.summary.expense)}</div>
                <div className="import-card-label">Estornos</div>
              </div>
            )}
            <div className="import-card-item">
              <BadgeCheck size={18} />
              <div className="import-card-value">{preview.summary.linked}</div>
              <div className="import-card-label">Vinculados</div>
            </div>
            <div className={`import-card-item${preview.summary.noMatch > 0 ? " warning" : ""}`}>
              <FileWarning size={18} />
              <div className="import-card-value">{preview.summary.noMatch}</div>
              <div className="import-card-label">Sem pedido</div>
            </div>
            <div className={`import-card-item${preview.summary.duplicated > 0 ? " warning" : ""}`}>
              <XCircle size={18} />
              <div className="import-card-value">{preview.summary.duplicated}</div>
              <div className="import-card-label">Duplicados</div>
            </div>
            <div className="import-card-item" style={{ opacity: 0.7 }}>
              <div className="import-card-value">{preview.summary.skipped}</div>
              <div className="import-card-label">Ignorados</div>
            </div>
          </div>

          {preview.warnings?.length > 0 && (
            <div className="alert warning" style={{ marginBottom: 12, fontSize: 13 }}>
              <strong>⚠️ {preview.warnings.length} pedido(s) com divergência de valor</strong>
              {preview.warnings.slice(0, 5).map((w: any) => (
                <div key={w.orderId} style={{ marginTop: 4 }}>
                  Pedido #{w.orderId}
                  {w.externalId ? ` (${w.externalId.slice(-8)})` : ""}:
                  recebido <strong>{money(w.receivedCents)}</strong> × esperado <strong>{money(w.expectedCents)}</strong>
                  {" "}({w.diffCents > 0 ? "+" : ""}{money(Math.abs(w.diffCents))})
                </div>
              ))}
              {preview.warnings.length > 5 && (
                <div style={{ marginTop: 4, color: "#92400e" }}>+{preview.warnings.length - 5} outro(s)</div>
              )}
            </div>
          )}

          {/* Summary text */}
          <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            {selectedKeys.size < selectable.length
              ? `${selectedKeys.size} de ${selectable.length} transações selecionadas.`
              : `${selectable.length} transações disponíveis para importação.`}
            {preview.summary.duplicated > 0 && ` ${preview.summary.duplicated} ignoradas (já importadas).`}
            {preview.summary.skipped > 0 && ` ${preview.summary.skipped} ignoradas (asset mgmt / reversões).`}
            {preview.summary.noMatch > 0 && ` ${preview.summary.noMatch} sem pedido vinculado (venda externa).`}
          </p>

          {/* Table */}
          {preview.rows.length > 0 && (
            <div className="table-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={selectedKeys.size === selectable.length && selectable.length > 0}
                        onChange={toggleAll}
                      />
                    </th>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Categoria</th>
                    <th>Descrição</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                    <th>Pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => {
                    const checked = selectedKeys.has(r.key);
                    const isSelectable = !r.skipped && r.status !== "duplicate";
                    return (
                      <tr key={r.key} style={{ opacity: isSelectable ? 1 : 0.4 }}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!isSelectable}
                            onChange={() => toggleOne(r.key)}
                          />
                        </td>
                        <td>{r.date}</td>
                        <td>
                          <span className={`status-badge ${r.type === "income" ? "status-novo" : "status-cancelado"}`}>
                            {r.type === "income" ? "Receita" : "Despesa"}
                          </span>
                        </td>
                        <td>{r.category}</td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.description}
                        </td>
                        <td className="money" style={{ color: r.type === "income" ? "#059669" : "#dc2626" }}>
                          {r.type === "income" ? "" : "-"}{money(r.amountCents)}
                        </td>
                        <td>
                          {r.skipped ? (
                            <span className="status-badge status-cancelado" style={{ fontSize: 10 }}>Ignorado</span>
                          ) : r.status === "duplicate" ? (
                            <span className="status-badge status-cancelado" style={{ fontSize: 10 }}>Duplicado</span>
                          ) : r.orderExternalId ? (
                            <span className="status-badge status-novo" style={{ fontSize: 10 }}>{r.orderExternalId.slice(0, 10)}...</span>
                          ) : (
                            <span className="status-badge status-enviado" style={{ fontSize: 10 }}>Externo</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Action buttons */}
          <div className="form-row">
            <button className="btn success" onClick={runImport} disabled={!anySelected}>
              <CheckCircle2 size={16} /> Confirmar importação
              {!anySelected && selectable.length > 0 ? " (selecione transações)" : ""}
            </button>
            <button className="btn" onClick={reset}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Importing */}
      {status === "importing" && (
        <div className="result">
          <h3 style={{ color: "#111" }}>
            <Loader2 className="spin" size={18} /> Importando...
          </h3>
        </div>
      )}

      {/* Result */}
      {status === "done" && result && (
        <div className="result">
          <h3><CheckCircle2 size={18} className="ok" /> Importação finalizada</h3>
          <div className="grid-2">
            <div>Transações importadas: <strong>{result.imported}</strong></div>
            <div>Transações duplicadas: <strong>{result.duplicated}</strong></div>
            <div>Erros: <strong>{result.errors.length}</strong></div>
          </div>
          {result.errors.length > 0 && (
            <div className="errors">
              <h4><FileWarning size={16} /> Erros encontrados</h4>
              <ul>
                {result.errors.map((e, i) => (
                  <li key={i}>Linha {e.line}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="form-row">
            <button className="btn primary" onClick={reset}>
              <Upload size={16} /> Nova importação
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {status === "error" && !error && (
        <div className="form-row">
          <button className="btn primary" onClick={parseLocal}>
            <Upload size={16} /> Tentar novamente
          </button>
          <button className="btn" onClick={reset}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
