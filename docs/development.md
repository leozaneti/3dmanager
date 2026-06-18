# Guia de Desenvolvimento — 3D Manager

> Como rodar, debugar, testar e adicionar funcionalidades no projeto.
> Para entender o "porquê" da arquitetura, veja [`architecture.md`](architecture.md).

---

## 1. Setup local

### Pré-requisitos

| Ferramenta | Versão | Como instalar |
|------------|--------|---------------|
| Node.js | 18+ (recomendado 20 LTS) | [nodejs.org](https://nodejs.org) ou `nvm install 20` |
| npm | 9+ | vem com Node |
| Git | 2+ | [git-scm.com](https://git-scm.com) |
| SQLite 3 CLI | 3.40+ | `sudo apt install sqlite3` (Linux) ou `brew install sqlite3` (macOS) |

### Primeira instalação

```bash
git clone https://github.com/leozaneti/3dmanager.git
cd 3dmanager
npm install           # instala dependências do package.json
npm run dev           # sobe backend (porta 3333) + frontend (porta 5173)
```

Acesse `http://localhost:5173`. O backend serve a API em `http://localhost:3333/api/*`.

### Sanity check

```bash
# Deve mostrar 244 testes passando
npm test

# Deve compilar sem erros (em ambos tsconfigs)
npx tsc --noEmit
```

---

## 2. Comandos do dia-a-dia

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | Sobe backend + frontend com hot-reload |
| `npm run dev:auth` | Mesmo, mas com autenticação habilitada (precisa setup de senha) |
| `npm test` | Roda os 244 testes (single-run) |
| `npm run test:watch` | Watch mode (TDD) |
| `npm run build` | Build de produção (gera `dist/` + `dist-server/`) |
| `npm run start` | Roda build de produção (porta 3333) |
| `npm run backup` | Backup manual de `data/prod.sqlite` |

Para inspecionar o banco direto:
```bash
sqlite3 data/dev.sqlite
> .schema
> select * from orders limit 5;
> .quit
```

---

## 3. Estrutura de pastas (essencial)

```
server/                 # Backend
├── index.ts            # Entry point: Fastify setup, plugins, route registration (80 linhas)
├── routes/             # Rotas modulares da API (orders, products, customers, imports, dashboard, finance, todos, admin, auth, backups)
├── db.ts               # Schema, migrações, seed
├── calculations.ts     # Fórmulas financeiras de pedido
├── financials.ts       # ⭐ Regra "Devolvido zera" — sempre edite aqui
├── importer.ts         # Importação ML
├── importerMp.ts       # Importação extrato MP
├── xlsxParser.ts       # Parse de XLSX
├── statusConfig.ts     # Transições de status
└── __tests__/          # 15 arquivos, 191 testes (ver detalhes em README.md)

src/
├── main.tsx            # Entry point
├── App.tsx             # ⭐ Routing + auth (114 linhas)
├── hooks/              # 4 hooks reutilizáveis
├── shared/             # 1 módulo compartilhado (brazilianStates)
└── ui/
    ├── api.ts          # Tipos + função `api()`
    ├── views/          # 4 views principais
    ├── PageHeader.tsx  # Componentes compartilhados
    ├── Panel.tsx
    ├── KpiCard.tsx
    ├── DatePresetBar.tsx
    └── utils/          # validators, format
```

> **Regra de ouro:** se você vai adicionar uma página nova, comece pelo `src/ui/views/NomeView.tsx`. Se for um componente reutilizável, vá em `src/ui/`. Hook em `src/hooks/`. Regra de negócio pura no backend em `server/`.

---

## 4. Adicionando uma nova view (passo a passo)

Cenário: você quer criar uma view "Relatórios" com estatísticas avançadas.

### 4.1. Backend: criar endpoint

```typescript
// server/routes/reports.ts (novo arquivo, registrar em server/index.ts)
import type { FastifyInstance } from "fastify";
import { all } from "./helpers.js";

export default function registerReportsRoutes(app: FastifyInstance) {
  app.get("/api/reports/advanced", (request) => {
    const fromDate = String(request.query.from ?? "");
    const toDate = String(request.query.to ?? "");
    // regra de negócio aqui (de preferência, delegar para server/financials.ts ou similar)
    return all(`
      select
        strftime('%Y-%m', sale_date) as month,
        sum(products_amount_cents) as revenue
      from orders
      where sale_date >= ? and sale_date <= ?
      group by month
    `, [fromDate, toDate]);
  });
}
```

### 4.2. Frontend: criar view

```typescript
// src/ui/views/ReportsView.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../PageHeader";
import { Panel } from "../Panel";
import { KpiCard } from "../KpiCard";
import { DatePresetBar, type DatePreset } from "../DatePresetBar";
import { dateRangeFor } from "../../hooks/useDatePresets";
import { api } from "../api";

export function ReportsView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const data = useQuery({
    queryKey: ["reports", "advanced", from, to],
    queryFn: () => api<{ month: string; revenue: number }[]>(`/reports/advanced?from=${from}&to=${to}`),
    enabled: !!from && !!to,
  });

  function setPreset(preset: DatePreset) {
    const r = dateRangeFor(preset);
    setFrom(r.startDate);
    setTo(r.endDate);
  }

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Estatísticas avançadas por período." />
      <div className="toolbar">
        <DatePresetBar
          onPresetChange={setPreset}
          startDate={from}
          endDate={to}
          onStartDateChange={setFrom}
          onEndDateChange={setTo}
        />
      </div>
      <Panel title="Receita por mês">
        <pre>{JSON.stringify(data.data, null, 2)}</pre>
      </Panel>
    </>
  );
}
```

### 4.3. Registrar no roteador

```typescript
// src/ui/App.tsx
import { ReportsView } from "./views/ReportsView";

// adicionar à lista `nav`:
const nav: { id: View; label: string; icon: LucideIcon }[] = [
  // ...
  { id: "reports", label: "Relatórios", icon: FileBarChart },
];

// adicionar ao switch:
{view === "reports" && <ReportsView />}
```

### 4.4. Adicionar tipo no `api.ts` se necessário

```typescript
// src/ui/api.ts
export type ReportRow = {
  month: string;
  revenue: number;
};
```

### 4.5. Escrever teste do backend

```typescript
// server/__tests__/reports.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { deleteDb } from "./helpers/setup.js";

let db: any, migrate: any;

beforeAll(async () => {
  deleteDb();
  const mod = await import("../db.js");
  db = mod.db;
  migrate = mod.migrate();
  // seedar dados de teste
  db.prepare("insert into orders (...) values (...)").run(...);
});

afterAll(() => deleteDb());

describe("GET /api/reports/advanced", () => {
  it("agrupa receita por mês", () => {
    const rows = db.prepare(`...`).all();
    expect(rows).toHaveLength(2);
  });
});
```

---

## 5. Adicionando uma regra de negócio (pura)

Cenário: você quer adicionar uma regra "Pedidos com valor > R$ 500 ganham tag VIP".

### 5.1. Adicionar função pura em `server/`

```typescript
// server/businessRules.ts (novo arquivo, ou dentro de financials.ts se fizer sentido)
export function isVipOrder(productsAmountCents: number): boolean {
  return productsAmountCents >= 50000; // R$ 500,00
}
```

### 5.2. Adicionar teste

```typescript
// server/__tests__/businessRules.test.ts
import { describe, it, expect } from "vitest";
import { isVipOrder } from "../businessRules";

describe("isVipOrder", () => {
  it("retorna true para pedidos >= R$ 500", () => {
    expect(isVipOrder(50000)).toBe(true);
    expect(isVipOrder(50001)).toBe(true);
  });
  it("retorna false para pedidos < R$ 500", () => {
    expect(isVipOrder(49999)).toBe(false);
  });
});
```

### 5.3. Usar na rota

```typescript
// server/routes/orders.ts — adicionar na função existente
import { isVipOrder } from "../businessRules.js";

// no handler GET /api/orders existente:
return rows.map((row) => ({ ...row, isVip: isVipOrder(row.productsAmountCents) }));
```

### 5.4. Expor no tipo e usar no frontend

```typescript
// src/ui/api.ts
export type Order = {
  // ...
  isVip?: boolean;
};
```

```typescript
// src/ui/views/OrdersView.tsx
{order.isVip && <span className="tag tag-gold">VIP</span>}
```

---

## 6. Adicionando um componente reutilizável

Cenário: você quer um `<StatusBadge>` que renderiza uma badge colorida baseada no status do pedido.

### 6.1. Criar componente

```typescript
// src/ui/StatusBadge.tsx
type StatusBadgeProps = {
  statusId: number;
  statusName: string;
};

const STATUS_CLASSES: Record<number, string> = {
  1: "novo", 3: "enviado", 4: "entregue", 5: "cancelado", 6: "devolvido"
};

export function StatusBadge({ statusId, statusName }: StatusBadgeProps) {
  const className = STATUS_CLASSES[statusId] ?? "";
  return <span className={`status-badge status-${className}`}>{statusName}</span>;
}
```

### 6.2. Substituir uso

```typescript
// src/ui/views/OrdersView.tsx
- <span className={`status-badge status-${STATUS_CLASS[order.statusId] ?? ""}`}>{order.statusName}</span>
+ <StatusBadge statusId={order.statusId} statusName={order.statusName} />
```

Remover o `STATUS_CLASS` local e a lógica inline.

### 6.3. Adicionar teste (opcional para componentes visuais)

```typescript
// src/ui/__tests__/StatusBadge.test.tsx
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../StatusBadge";

it("renderiza nome do status", () => {
  render(<StatusBadge statusId={4} statusName="Entregue" />);
  expect(screen.getByText("Entregue")).toBeInTheDocument();
});
```

---

## 7. Adicionando um hook reutilizável

Cenário: você quer um hook que debounce um valor de input.

```typescript
// src/hooks/useDebounce.ts
import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
```

```typescript
// src/hooks/__tests__/useDebounce.test.ts
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "../useDebounce";

it("retorna valor inicial imediatamente", () => {
  const { result } = renderHook(() => useDebounce("a", 100));
  expect(result.current).toBe("a");
});

it("atualiza após o delay", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ value }) => useDebounce(value, 100), {
    initialProps: { value: "a" },
  });
  rerender({ value: "b" });
  act(() => vi.advanceTimersByTime(100));
  expect(result.current).toBe("b");
});
```

---

## 8. Debugando

### Backend

```bash
# ver logs do backend
cd server
npx tsx --watch index.ts  # ou npm run dev:api

# ver query SQL gerada
sqlite3 data/dev.sqlite
> select sql from sqlite_master where name='orders';
> explain query plan select * from orders where sale_date > '2024-01-01';
```

### Frontend

```bash
# React DevTools (extensão do navegador)
# Inspecionar:
# - React Query DevTools (no painel da extensão)
# - Network tab (chamadas /api/*)
# - Console do browser (logs, warnings)
```

### Testes

```bash
# Rodar um único teste
npx vitest --run server/__tests__/financials.test.ts

# Watch mode
npx vitest server/__tests__/financials.test.ts
```

---

## 9. Padrões de código

### Backend (Fastify + Zod)

- **Toda rota de escrita** deve ter `Zod schema` no body. Sem exceção.
- **Toda regra de negócio** que envolve `if/else` com `isDevolvido ? 0 : X` deve virar função em `server/financials.ts` (ou módulo similar).
- **Toda agregação** (`SUM/COUNT/AVG`) deve ser feita no SQL, não em JS.
- **Toda query** que carrega lista deve ter `LIMIT` por padrão para evitar OOM.

### Frontend (React)

- **Componentes de view** ficam em `src/ui/views/NomeView.tsx`. São stateful.
- **Componentes puros** ficam em `src/ui/`. Recebem props, não têm useState.
- **Hooks customizados** ficam em `src/hooks/`. Nunca em view.
- **Tipos compartilhados com backend** ficam em `src/ui/api.ts`.
- **Mutations** sempre invalidam as queryKeys relevantes no `onSuccess`.
- **Forms** sempre validam antes de submeter (Zod ou `validateDocument`).
- **Estados de loading** sempre explícitos (`isLoading` + skeleton OU `isFetching` + texto "Atualizando...").

### Estilo

- **TypeScript strict** — sem `any` exceto em integrações externas com tipos fracos.
- **Imports relativos** — `../` (não alias) para manter compatibilidade com Vite + tsc.
- **Estilos** — `src/styles.css` global + classes (não CSS modules). Componentes têm `className` próprio.

---

## 10. Checklist antes de abrir PR

- [ ] `npm test` passa (244 testes)
- [ ] `npx tsc --noEmit` não retorna erros
- [ ] Se adicionou rota nova: schema Zod validado
- [ ] Se adicionou regra de negócio: testada (pura ou via integração)
- [ ] Se adicionou componente: importado no `App.tsx` se for nova view
- [ ] Se adicionou hook: documentado em `docs/architecture.md` (seção "Hooks reutilizáveis")
- [ ] Se mexeu em `db.ts` (schema): testado que `migrate()` ainda funciona (caso `deleteDb + migrate` em teste)
- [ ] Se mexeu em `financials.ts`: 25 testes devem continuar passando

---

## 11. Onde pedir ajuda

| Tipo | Canal |
|------|-------|
| Dúvida de regra de negócio | [`docs/regras-de-negocio.md`](regras-de-negocio.md) |
| Dúvida arquitetural | [`docs/architecture.md`](architecture.md) |
| Bug ou feature | Issue no GitHub |
| Hot fix urgente | Branch `hotfix/*` → merge direto em `main` (sem PR) |
