import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { ModalShell } from "./ModalShell";

type Dependency = {
  label: string;
  count: number;
  action: string;
};

type Props = {
  open: boolean;
  title: string;
  entityName: string;
  dependencies?: Dependency[];
  dependencyEndpoint?: string;
  dependencyQueryKey?: (string | number)[];
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  confirmLabel?: string;
};

export function ConfirmDeleteModal({
  open,
  title,
  entityName,
  dependencies: depsProp,
  dependencyEndpoint,
  dependencyQueryKey,
  onConfirm,
  onCancel,
  loading: loadingProp,
  confirmLabel
}: Props) {
  const depsQuery = useQuery({
    queryKey: dependencyQueryKey ?? ["deps", dependencyEndpoint],
    queryFn: () => api<any>(dependencyEndpoint!),
    enabled: open && !!dependencyEndpoint && !depsProp
  });

  const deps = depsProp ?? (depsQuery.data ? extractDeps(depsQuery.data) : []);

  const loading = loadingProp || depsQuery.isLoading;

  const totalDeps = deps.reduce((s, d) => s + d.count, 0);

  return (
    <ModalShell open={open} onClose={onCancel} title={title}
      maxWidth="480px" closeOnOverlayClick={!loading} closeDisabled={loading}
      bodyStyle={{ padding: "24px" }}>
          <p style={{ fontSize: "14px", color: "#555", margin: "0 0 4px" }}>
            Tem certeza que deseja excluir
          </p>
          <p style={{ fontSize: "18px", fontWeight: 600, color: "#111", margin: "0 0 20px" }}>
            {entityName}
          </p>

          {loading && (
            <div style={{ color: "#999", fontSize: "13px", padding: "12px 0" }}>
              Verificando dependências...
            </div>
          )}

          {!loading && (
            <div style={{ background: "#f8f9fa", borderRadius: "8px", padding: "14px", marginBottom: "16px" }}>
              {totalDeps > 0 ? (
                <>
                  <div style={{ fontSize: "13px", fontWeight: 500, color: "#dc2626", marginBottom: "6px" }}>
                    ⚠ {totalDeps === 1 ? "1 registro vinculado" : `${totalDeps} registros vinculados`}
                  </div>
                  {deps.map((dep, i) => (
                    <div key={i} style={{ fontSize: "13px", color: "#555", lineHeight: "1.6" }}>
                      {dep.label}: <strong>{dep.count}</strong>. {dep.action}
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ fontSize: "13px", color: "#666" }}>
                  Nenhum registro vinculado.
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: "12px", color: "#999", marginBottom: "20px" }}>
            Esta ação não pode ser desfeita.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button type="button" className="btn-order btn-order-ghost" onClick={onCancel} disabled={loading}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-order"
              style={{ background: "#dc2626", color: "#fff", border: "none" }}
              onClick={onConfirm}
              disabled={loading}
            >
              {confirmLabel || "Excluir"}
            </button>
          </div>
    </ModalShell>
  );
}

function extractDeps(data: Record<string, unknown>): Dependency[] {
  const result: Dependency[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === "totalOrders") {
      result.push({ label: "Pedidos", count: Number(v), action: "Os pedidos não serão excluídos. Ficarão sem cliente associado." });
    } else if (k === "orderItemsCount") {
      result.push({ label: "Itens de pedido", count: Number(v), action: "Serão desvinculados deste produto." });
    }
  }
  return result;
}
