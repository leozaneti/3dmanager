import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload, CheckCircle2, XCircle, FileWarning, Loader2,
  FileSpreadsheet, Package, AlertTriangle, CopyCheck,
  ChevronDown, ChevronRight, BadgeCheck, Plus
} from "lucide-react";
import { api, money, type Settings } from "./api";
import { ProductModal } from "./ProductModal";
import { Notification } from "./Notification";
import { Pagination } from "./Pagination";
import { useSelection } from "../hooks/useSelection";

type ImportStatus = "idle" | "preview" | "importing" | "done" | "error";

interface SalePreviewItem {
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
}

interface SalePreview {
  saleNumber: string;
  orderNumber?: string;
  buyer: string;
  status: string;
  total: number;
  items: SalePreviewItem[];
  document: string;
  hasMissingSku: boolean;
  existingOrderId: number | null;
  hasChanges: boolean;
  changes: { field: string; from: string; to: string }[];
}

interface PreviewData {
  token: string;
  sales: SalePreview[];
  summary: {
    foundOrders: number;
    newCustomers: number;
    existingCustomers: number;
    duplicated: number;
    missingSkus: number;
  };
  missingSkusList: string[];
  unmatchedTitlesList: string[];
  newCustomerNames: string[];
  errors: { row: number; message: string }[];
  customerCountNote?: string;
}

interface ImportResultData {
  importedOrders: number;
  duplicatedOrders: number;
  updatedOrders: number;
  createdCustomers: number;
  reusedCustomers: number;
  updatedCustomers: number;
  importedItems: number;
  ignoredItems: number;
  errors: { line: number; message: string }[];
}

const PAGE_SIZE = 10;

export function ImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResultData | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [validFormat, setValidFormat] = useState<boolean | null>(null);
  const [progressToken, setProgressToken] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [creatingSku, setCreatingSku] = useState<{ sku: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qc = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });

  const getKey = (s: SalePreview) => s.saleNumber || s.orderNumber || "";

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleFileSelect = (f: File | null) => {
    setFile(f);
    setStatus("idle");
    setPreview(null);
    setResult(null);
    setError("");
    setToken(null);
    setSelectedKeys(new Set());
    setPage(0);
    setExpandedRows(new Set());
    setValidFormat(null);
    setProgressToken(null);
    setProgress({ current: 0, total: 0 });
    if (!f) { setFileName(""); setFileSize(0); return; }
    setFileName(f.name);
    setFileSize(f.size);
    validateFormat(f);
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
    if (!f || (!f.name.endsWith(".xlsx") && !f.name.endsWith(".xls"))) {
      setError("Formato não suportado. Use .xlsx ou .xls");
      return;
    }
    handleFileSelect(f);
  };

  async function validateFormat(f: File) {
    const fd = new FormData();
    fd.append("file", f, f.name);
    try {
      const res = await fetch("http://127.0.0.1:3333/api/imports/validate", { method: "POST", body: fd });
      const data = await res.json();
      setValidFormat(data.valid);
    } catch {
      setValidFormat(false);
    }
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

  const parseLocal = async () => {
    if (!file) return;
    setStatus("preview");
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const res = await apiDirect<PreviewData>("/imports/preview", formData);
      setToken(res.token);
      setPreview(res);
      setSelectedKeys(new Set(res.sales.filter(s => !s.hasMissingSku).map(s => getKey(s))));
      setPage(0);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  };

  const startPolling = (ptoken: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:3333/api/imports/progress/${ptoken}`);
        if (!res.ok) { stopPolling(); return; }
        const data = await res.json() as {
          current: number;
          total: number;
          status: string;
          result?: ImportResultData;
          error?: string;
        };
        setProgress({ current: data.current, total: data.total });
        if (data.status === "done" && data.result) {
          stopPolling();
          setResult(data.result);
          setStatus("done");
          qc.invalidateQueries();
          setMessage(`${data.result.importedOrders} pedidos importados com sucesso.`);
        } else if (data.status === "error") {
          stopPolling();
          setError(data.error || "Erro na importação");
          setStatus("error");
        }
      } catch {
        // Silently retry on next interval
      }
    }, 1000);
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const runImport = async () => {
    if (!token) return;
    setStatus("importing");
    setError("");
    setProgress({ current: 0, total: 0 });
    try {
      const res = await apiDirect<{ progressToken: string }>("/imports/confirm", {
        token,
        selectedKeys: [...selectedKeys],
      });
      setProgressToken(res.progressToken);
      startPolling(res.progressToken);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  };

  function findProductTitleForSku(preview: PreviewData, sku: string): string {
    for (const sale of preview.sales) {
      for (const item of sale.items) {
        if (item.sku === sku && item.title) return item.title;
      }
    }
    return "";
  }

  const handleProductCreated = () => {
    setCreatingSku(null);
    if (file) {
      const formData = new FormData();
      formData.append("file", file, file.name);
      apiDirect<PreviewData>("/imports/preview", formData).then((res) => {
        setToken(res.token);
        setPreview(res);
      setSelectedKeys(new Set(res.sales.filter(s => !s.hasMissingSku).map(s => getKey(s))));
        setPage(0);
      }).catch(() => {});
    }
  };

  const reset = () => {
    stopPolling();
    setFile(null);
    setFileName("");
    setFileSize(0);
    setStatus("idle");
    setPreview(null);
    setResult(null);
    setError("");
    setToken(null);
    setSelectedKeys(new Set());
    setPage(0);
    setExpandedRows(new Set());
    setValidFormat(null);
    setProgressToken(null);
    setProgress({ current: 0, total: 0 });
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const toggleAll = () => {
    if (!preview) return;
    const selectable = preview.sales.filter(s => !s.hasMissingSku);
    if (selectedKeys.size === selectable.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(selectable.map(s => getKey(s))));
    }
  };

  const toggleOne = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const toggleExpand = (key: string) => {
    const next = new Set(expandedRows);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedRows(next);
  };

  const totalPages = preview ? Math.ceil(preview.sales.length / PAGE_SIZE) : 0;
  const currentPage = preview ? preview.sales.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];
  const anySelected = selectedKeys.size > 0;
  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

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

  return (
    <div className="import-view">
      <h2 className="page-title">Importar Pedidos</h2>

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
          <strong>{fileName || "Clique ou arraste o arquivo aqui"}</strong>
          {fileName && <span>{(fileSize / 1024).toFixed(1)} KB</span>}
          {validFormat === true && (
            <span style={{ color: "#059669", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <BadgeCheck size={16} /> Formato Mercado Livre reconhecido
            </span>
          )}
          {validFormat === false && (
            <span style={{ color: "#dc2626", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <XCircle size={16} /> Formato não reconhecido. Use planilha do Mercado Livre.
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
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

      {/* Message notification */}
      <Notification message={message} onClose={() => setMessage("")} variant="success" />

      {/* Preview button (idle + file selected) */}
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
          <div className="import-cards">
            <div className="import-card-item">
              <Package size={18} />
              <div className="import-card-value">{preview.summary.foundOrders}</div>
              <div className="import-card-label">Pedidos encontrados</div>
            </div>
            <div className={`import-card-item${preview.summary.missingSkus > 0 ? " warning" : ""}`}>
              <Package size={18} />
              <div className="import-card-value">{preview.summary.missingSkus}</div>
              <div className="import-card-label">SKUs não cadastrados</div>
            </div>
            <div className={`import-card-item${preview.summary.duplicated > 0 ? " warning" : ""}`}>
              <CopyCheck size={18} />
              <div className="import-card-value">{preview.summary.duplicated}</div>
              <div className="import-card-label">Duplicados</div>
            </div>
            <div className={`import-card-item${preview.errors.length > 0 ? " danger" : ""}`}>
              {preview.errors.length > 0 ? <AlertTriangle size={18} /> : <BadgeCheck size={18} />}
              <div className="import-card-value">{preview.errors.length}</div>
              <div className="import-card-label">Erros</div>
            </div>
          </div>

          {/* Summary text */}
          <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
            {selectedKeys.size < preview.sales.length
              ? `${selectedKeys.size} de ${preview.sales.length} pedidos selecionados.`
              : `${preview.sales.length} pedidos disponíveis para importação.`}
            {preview.summary.duplicated > 0 && ` ${preview.summary.duplicated} ignorados (já importados).`}
            {preview.summary.missingSkus > 0 && ` ${preview.summary.missingSkus} produto(s) não cadastrado(s).`}
            {preview.customerCountNote && ` ${preview.customerCountNote}`}
          </p>

          {/* Missing SKUs list */}
          {preview.missingSkusList.length > 0 && (
            <div className="import-new-customers" style={{ borderColor: "#fde7c7", background: "#fff7ed" }}>
              <h4 style={{ color: "#9a3412" }}><FileWarning size={16} /> SKUs não cadastrados ({preview.missingSkusList.length})</h4>
              <div className="tags">
                {preview.missingSkusList.map((sku, i) => (
                  <button
                    key={i}
                    type="button"
                    className="tag"
                    style={{ background: "#fed7aa", color: "#9a3412", cursor: "pointer", border: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                    onClick={() => {
                      const title = findProductTitleForSku(preview, sku);
                      setCreatingSku({ sku, name: title || "" });
                    }}
                    title="Clique para cadastrar este produto"
                  >
                    <Plus size={12} /> {sku}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: "#9a3412", marginTop: 8 }}>
                Clique em um SKU para cadastrar o produto. Pedidos com esses SKUs serão ignorados na importação até que o produto exista.
              </p>
            </div>
          )}

          {/* Unmatched titles list */}
          {preview.unmatchedTitlesList && preview.unmatchedTitlesList.length > 0 && (
            <div className="import-new-customers" style={{ borderColor: "#fde7c7", background: "#fff7ed" }}>
              <h4 style={{ color: "#9a3412" }}><FileWarning size={16} /> Produtos sem SKU — não encontrados ({preview.unmatchedTitlesList.length})</h4>
              <div className="tags">
                {preview.unmatchedTitlesList.map((title, i) => (
                  <button
                    key={i}
                    type="button"
                    className="tag"
                    style={{ background: "#fed7aa", color: "#9a3412", cursor: "pointer", border: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                    onClick={() => setCreatingSku({ sku: "", name: title })}
                    title="Clique para cadastrar este produto"
                  >
                    <Plus size={12} /> {title}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: "#9a3412", marginTop: 8 }}>
                Clique em um título para cadastrar o produto e definir seu SKU. Pedidos serão ignorados até que o produto exista.
              </p>
            </div>
          )}

          {/* Table */}
          {preview.sales.length > 0 && (
            <div className="table-wrap">
              <table className="import-preview-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={selectedKeys.size === preview.sales.length}
                        onChange={toggleAll}
                      />
                    </th>
                    <th></th>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>SKUs</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPage.map((s) => {
                    const key = getKey(s);
                    const checked = selectedKeys.has(key);
                    const expanded = expandedRows.has(key);
                    return (
                      <React.Fragment key={key}>
                        <tr style={{ opacity: checked && !s.hasMissingSku ? 1 : 0.4 }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={s.hasMissingSku}
                              onChange={() => toggleOne(key)}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => toggleExpand(key)}
                              style={{ fontSize: 14 }}
                            >
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td style={{ fontWeight: 600 }}>
                            {key}
                            {s.hasMissingSku && <span className="status-badge status-cancelado" style={{ marginLeft: 6, fontSize: 10 }}>SKU pendente</span>}
                            {s.hasChanges && !s.hasMissingSku && <span className="status-badge status-enviado" style={{ marginLeft: 6, fontSize: 10 }}>Atualizável</span>}
                          </td>
                          <td>{s.buyer}</td>
                          <td>
                            {s.items.map(i => (
                              <span key={i.sku} style={{ color: s.hasMissingSku && preview.missingSkusList.includes(i.sku) ? "#dc2626" : "inherit" }}>
                                {i.sku}{" "}
                              </span>
                            ))}
                          </td>
                          <td className="money">{money(s.total)}</td>
                          <td>
                            <span className={`status-badge status-${s.status.toLowerCase() === "cancelado" ? "cancelado" : "novo"}`}>
                              {s.status}
                            </span>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="import-row-expand-tr">
                            <td colSpan={7}>
                              <div className="import-row-expand">
                                {s.changes && s.changes.length > 0 && (
                                  <div className="import-changes">
                                    <div className="import-changes-title">Atualizações detectadas:</div>
                                    {s.changes.map((c, i) => (
                                      <div key={i} className="import-change-row">
                                        <span className="import-change-field">{c.field}</span>
                                        <span className="import-change-from">{c.from}</span>
                                        <span className="import-change-arrow">→</span>
                                        <span className="import-change-to">{c.to}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <table className="items-mini-table">
                                  <thead>
                                    <tr>
                                      <th>SKU</th>
                                      <th>Produto</th>
                                      <th style={{ textAlign: "right" }}>Qtd</th>
                                      <th style={{ textAlign: "right" }}>Preço unit.</th>
                                      <th style={{ textAlign: "right" }}>Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.items.map((item, i) => (
                                      <tr key={i}>
                                        <td style={{ fontWeight: 500 }}>{item.sku}</td>
                                        <td>{item.title}</td>
                                        <td style={{ textAlign: "right" }}>{item.quantity}</td>
                                        <td style={{ textAlign: "right" }}>{money(item.unitPrice)}</td>
                                        <td style={{ textAlign: "right" }}>{money(item.unitPrice * item.quantity)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="import-pagination">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
              <span>Página {page + 1} de {totalPages} ({preview.sales.length} pedidos)</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Próximo</button>
            </div>
          )}

          {/* Errors */}
          {preview.errors.length > 0 && (
            <div className="errors" style={{ marginTop: 14 }}>
              <h4><FileWarning size={16} /> Erros encontrados na planilha</h4>
              <ul>
                {preview.errors.map((e, i) => (
                  <li key={i}>Linha {e.row}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Action buttons */}
          <div className="form-row">
            <button className="btn success" onClick={runImport} disabled={!anySelected}>
              <CheckCircle2 size={16} /> Confirmar importação
              {!anySelected && preview.sales.length > 0 ? " (selecione pedidos)" : ""}
            </button>
            <button className="btn" onClick={reset}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Importing progress */}
      {status === "importing" && (
        <div className="result">
          <h3 style={{ color: "#111" }}>
            <Loader2 className="spin" size={18} />
            {progressPct > 0 ? `Importando... ${progress.current} de ${progress.total}` : "Iniciando importação..."}
          </h3>
          <div className="progress-bar-wrap">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="progress-text">{progressPct}%</span>
          </div>
          <p style={{ fontSize: 13, color: "#888", marginTop: 8 }}>
            Processando pedido {Math.min(progress.current + 1, progress.total)} de {progress.total}
          </p>
        </div>
      )}

      {/* Result */}
      {status === "done" && result && (
        <div className="result">
          <h3><CheckCircle2 size={18} className="ok" /> Importação finalizada</h3>
          <div className="grid-2">
            <div>Pedidos importados: <strong>{result.importedOrders}</strong></div>
            <div>Pedidos duplicados: <strong>{result.duplicatedOrders}</strong></div>
            {result.updatedOrders > 0 && <div>Pedidos atualizados: <strong>{result.updatedOrders}</strong></div>}
            <div>Clientes criados: <strong>{result.createdCustomers}</strong></div>
            <div>Clientes reutilizados: <strong>{result.reusedCustomers}</strong></div>
            <div>Clientes atualizados: <strong>{result.updatedCustomers}</strong></div>
            <div>Itens importados: <strong>{result.importedItems}</strong></div>
            <div>Itens ignorados: <strong>{result.ignoredItems}</strong></div>
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

      {/* Error state (after failed import) */}
      {status === "error" && !error && (
        <div className="form-row">
          <button className="btn primary" onClick={parseLocal}>
            <Upload size={16} /> Tentar novamente
          </button>
          <button className="btn" onClick={reset}>Cancelar</button>
        </div>
      )}

      {/* Product modal for creating missing SKUs */}
      <ProductModal
        settings={settingsQuery.data ?? null}
        editing={null}
        open={creatingSku !== null}
        initialSku={creatingSku?.sku}
        initialName={creatingSku?.name}
        onClose={handleProductCreated}
      />
    </div>
  );
}
