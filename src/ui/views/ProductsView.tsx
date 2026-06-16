import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { api, money, Paginated, Product, type Settings as SettingsType } from "../api";
import { PageHeader } from "../PageHeader";
import { Panel } from "../Panel";
import { Pagination } from "../Pagination";
import { Notification } from "../Notification";
import { ProductModal } from "../ProductModal";
import { ConfirmDeleteModal } from "../ConfirmDeleteModal";
import { KpiCard } from "../KpiCard";
import { useDeleteMutation } from "../../hooks/useDeleteMutation";
import { useSelection } from "../../hooks/useSelection";
import { useSort } from "../../hooks/useSort";
import type { Meta } from "../api";

export function ProductsView({ meta }: { meta: Meta }) {
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
      <PageHeader title="Produtos" subtitle="Ficha técnica com cálculo automático de custo de produção." />
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
                <th>Preço</th>
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
                  <td>
                    {product.minSalePriceCents != null && product.minSalePriceCents > 0
                      ? `${money(product.minSalePriceCents)}${product.maxSalePriceCents !== product.minSalePriceCents ? ` ~ ${money(product.maxSalePriceCents)}` : ""}`
                      : "—"}
                  </td>
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
                  <td colSpan={9}>Sem produtos cadastrados ainda.</td>
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
        channels={meta.channels}
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
