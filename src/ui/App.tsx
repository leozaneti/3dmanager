import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  FileX,
  Sliders,
  type LucideIcon,
  ListChecks,
  Package,
  ShoppingCart,
  UserRound,
  Wallet,
} from "lucide-react";
import { api, Meta } from "./api";
import { FinanceView } from "./FinanceView";
import { ImportView } from "./ImportView";
import { KanbanView } from "./KanbanView";
import { Dashboard } from "./dashboard/Dashboard";
import { Login } from "./Login";
import { Setup } from "./Setup";
import { ProductsView } from "./views/ProductsView";
import { CustomersView } from "./views/CustomersView";
import { OrdersView } from "./views/OrdersView";
import { SettingsView } from "./views/SettingsView";

/**
 * Máquina de estados da autenticação:
 *   loading       → consulta /api/auth/status
 *   disabled      → AUTH_ENABLED=false, renderiza o app direto
 *   setup         → AUTH_ENABLED=true mas senha não configurada → <Setup />
 *   login         → AUTH_ENABLED=true, senha existe, não autenticado → <Login />
 *   authenticated → sessão válida → renderiza sidebar + views
 *
 * Views são roteadas via state local `view`, sem router — trocar de view
 * é apenas `setView("orders")`.
 */
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

  function handleEditOrder(orderId: number) {
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
      {view === "orders" && <OrdersView meta={meta} pendingOrderId={pendingOrderId} onConsumePendingOrder={() => setPendingOrderId(null)} />}
      {view === "products" && <ProductsView meta={meta} />}
      {view === "customers" && <CustomersView onEditOrder={handleEditOrder} />}
      {view === "finance" && <FinanceView onEditOrder={handleEditOrder} />}
      {view === "todos" && <KanbanView />}
      {view === "import" && <ImportView />}
      {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
