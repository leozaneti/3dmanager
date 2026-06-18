# Arquitetura — 3D Manager

> Visão geral de como o sistema se organiza, como os dados fluem e por que cada peça existe.
> Para detalhes de cada regra de negócio, veja [`regras-de-negocio.md`](regras-de-negocio.md).

---

## Stack em 1 diagrama

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Browser (React)                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────────────┐  │
│  │  Views      │ │  Modals     │ │  Hooks      │ │  Shared Utils     │  │
│  │  (App.tsx   │ │ (ModalShell │ │ (useSort,   │ │ (brazilianStates, │  │
│  │   roteia)   │ │  + conteúdo │ │  useDate...)│ │  validators...)   │  │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └─────────┬─────────┘  │
│         └───────────────┴──────────────┴─────────────────┘            │
│                              │ React Query (cache, fetch, mutations) │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTP/JSON (fetch /api/*)
┌──────────────────────────────┴───────────────────────────────────────┐
│                        Fastify (Node 18+)                              │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Rotas (server/routes/*.ts — orders, products, customers, ...)   │ │
│  │   - Validação Zod → chama regra de negócio → persiste via db     │ │
│  │   - Endpoints REST: /orders, /customers, /products, /finance...  │ │
│  └──────┬─────────────────────────────────────┬─────────────────────┘ │
│         │                                     │                     │
│  ┌──────┴────────┐                  ┌─────────┴────────┐            │
│  │  Módulos de   │                  │   db.ts          │            │
│  │  domínio:    │                  │   - Schema,      │            │
│  │  - calcul.    │                  │   - Migrações,   │            │
│  │  - financials │                  │   - Seed,        │            │
│  │  - importer   │                  │   - Backup auto  │            │
│  │  - importerMp │                  │   - execFileSync │            │
│  │  - statusConfig                  │     "sqlite3"   │            │
│  │  - brazilStates                  │     CLI          │            │
│  └──────┬────────┘                  └─────────┬────────┘            │
│         │                                     │                      │
└─────────┼─────────────────────────────────────┼──────────────────────┘
          │                                     │
          ▼                                     ▼
   ┌─────────────────┐                 ┌──────────────────┐
   │  Regras puras   │                 │   SQLite 3        │
   │  (testáveis     │                 │   (1 arquivo por  │
   │   sem DB)       │                 │    ambiente)      │
   └─────────────────┘                 └──────────────────┘
```

---

## Fluxo de uma requisição típica

Exemplo: usuário clica em "Salvar" no modal de edição de pedido.

```
1. React (OrderModal.tsx) chama useMutation → onSubmit
2. api("/orders/123", { method: "PUT", body: JSON.stringify(...) })
3. fetch() → /api/orders/123 com Cookie de sessão
4. Fastify: authMiddleware valida sessão (se AUTH_ENABLED)
5. Fastify: zod schema valida payload → entra no handler
6. Handler chama db.transaction(() => { ... })
7. db.ts serializa os ? para literais e executa via execFileSync("sqlite3", ...)
8. SQLite 3 lê/escreve o arquivo data/dev.sqlite (ou prod.sqlite)
9. Resposta JSON volta pelo mesmo caminho até o React Query
10. React Query invalida ["orders", "dashboard"] → refetch automático
11. UI atualiza sem reload (grato ao React Query)
```

---

## Onde mora cada regra de negócio

| Regra | Local | Por que aí |
|-------|-------|-----------|
| Cálculo financeiro de pedido | `server/calculations.ts` | Função pura, sem side effects, fácil de testar |
| "Devolvido zera" | `server/financials.ts` | Centralizada — usada por import, update, e DRE |
| Mapeamento ML → status | `server/importShared.ts` + `server/xlsxParser.ts` | Específico do parser do Mercado Livre |
| Cálculo de cupom | `server/financials.ts` (computeCupomCents) | Sub-função da regra "Devolvido zera" |
| Match product por título | `server/financials.ts` (matchProductByTitle) | Compartilhado entre preview e import real |
| Transições de status | `server/statusConfig.ts` (STATUS_TRANSITIONS) | Tabela pura, sem dependência de DB |
| Deduplicação de cliente | `server/importer.ts` (ensureCustomer) | Específico do fluxo de import |
| Unicidade SKU | SQL: `UNIQUE` na coluna `products.sku` | Garantida pelo banco |

**Princípio:** regras de negócio em funções puras (sem `db.*`) → testáveis sem mock. I/O em handlers de rota → fino, só validação e orquestração.

---

## Hooks e componentes reutilizáveis

```
┌──────────────────────────────────────────────────────┐
│  Hooks                                                │
│  ├─ useSort(data, defaultKey) → ordenação             │
│  ├─ useSelection(items) → checkbox múltiplo            │
│  ├─ useDeleteMutation({ endpoint, invalidate }) → CRUD│
│  └─ useDatePresets → ranges (today/7d/30d/...)      │
├──────────────────────────────────────────────────────┤
│  Componentes                                           │
│  ├─ <PageHeader title subtitle />                     │
│  ├─ <Panel title>{children}</Panel>                    │
│  ├─ <KpiCard /> / <KpiHero />                        │
│  ├─ <DatePresetBar presets onChange />                │
│  ├─ <ModalShell asForm onSubmit>{children}</ModalShell>│
│  ├─ <Pagination page total onPageChange />            │
│  ├─ <Notification variant message />                  │
│  └─ <ConfirmDeleteModal dependencyEndpoint />         │
├──────────────────────────────────────────────────────┤
│  Utils                                                │
│  ├─ brazilianStates (UF ↔ nome) — front + back       │
│  └─ validators (CPF/CNPJ)                             │
└──────────────────────────────────────────────────────┘
```

**Reutilização concreta** (linhas de código economizadas):

| Componente/Hook | Views que usam | Linhas economizadas (~) |
|-----------------|---------------|--------------------------|
| `<DatePresetBar>` | OrdersView, CustomersView, Dashboard, FinanceView | ~150 |
| `useSort` | ProductsView, CustomersView, OrdersView, FinanceView | ~80 |
| `<PageHeader>` / `<Panel>` | Todas as views | ~30 |
| `brazilianStates` | index.ts, importer.ts, CustomersView | ~30 |
| `financials.ts` | index.ts, importer.ts | ~80 |

---

## Banco de dados

### Diagrama ER (simplificado)

```
┌──────────┐      ┌──────────┐      ┌──────────┐
│  stores  │──┐   │  orders  │──┐   │  products│
└──────────┘  │   │          │  │   └──────────┘
             │   │          │  │        ▲
             ▼   │          ▼  │        │
       ┌────────────┐   ┌──────────┐   │
       │order_       │   │order_    │───┘
       │financials   │   │items     │
       └────────────┘   └──────────┘
                          (FK nullable)

┌──────────┐      ┌──────────┐      ┌──────────┐
│customers │─────▶│  orders  │      │  sales_  │
└──────────┘      │          │◀─────│ channels │
                  └──────────┘      └──────────┘
                       ▲
                       │
                  ┌──────────┐
                  │  trans.  │
                  │  actions │
                  └────┬─────┘
                       │
                  ┌────────────┐
                  │ transaction│
                  │   _orders  │
                  └────────────┘
                       ▲
                       │
┌──────────┐      ┌──────────┐
│finance_  │      │transactions│
│categories│      └──────────┘
└──────────┘
```

### Decisões de modelagem

- **Valores em centavos (INTEGER)** — nunca `FLOAT`. Elimina erros de arredondamento.
- **`external_order_id` é UNIQUE por (store_id, sales_channel_id)** — permite o mesmo ID de pedido ML em duas lojas diferentes.
- **`order_financials` é 1:1 com `orders`** — separação física de dados transacionais vs. estruturais facilita queries de KPI (somente campos numéricos).
- **`order_items.product_id` é NULLABLE** — exclusão de produto não remove itens do pedido, apenas desvincula.
- **`status_description` TEXT** — preserva texto original do ML (caso status interno não represente bem a realidade).
- **Cascading deletes** — `order_financials` e `order_items` são deletados em cascata quando `orders` é removido. `transaction_orders` quando qualquer lado é removido.

---

## Decisões de arquitetura

### Por que SQLite via CLI (`execFileSync`) e não via driver?

O backend usa `execFileSync("sqlite3", ...)` em cada query — cada `db.prepare().get/all/run` faz um `fork() + exec` do binário.

**Prós:** zero dependência nativa, funciona em qualquer sistema com `sqlite3` instalado, debug trivial (`sqlite3 data/dev.sqlite`).
**Contras:** latência alta em queries (4+ forks por página de UI), parsing JSON.

Foi documentado plano para migrar para `better-sqlite3` (in-process, 10-50x mais rápido), mas o ambiente local tem Node com ABI 109 modificado (Ubuntu noble) que impede o build do módulo. A migração está bloqueada no ambiente; em Docker/Node padrão, o `package.json` aceitará o módulo.

### Por que `execFileSync` mesmo no import (lote grande)?

O import de N pedidos usa `beginBatch/commitBatch` que faz um único `fork()` para todas as statements. Os imports de 500+ pedidos do ML levam ~2s, aceitável para o volume típico.

### Por que centavos em vez de reais (REAL)?

SQLite tem `REAL` (8-byte float) que perde precisão em cálculos de soma. Para valores monetários, `INTEGER` em centavos garante exatidão:
- `R$ 1,99` → `199`
- `R$ 19,99 + R$ 0,01 = R$ 20,00` → `1999 + 1 = 2000` ✓
- vs. `19.99 + 0.01 = 20.000000000000004` ✗

A formatação para BRL acontece apenas no momento de exibição (`money()` em `src/ui/api.ts`).

### Por que `React Query` em vez de `fetch` puro?

- **Cache automático** — ao voltar para uma view, dados anteriores aparecem instantaneamente.
- **Invalidação por chave** — `queryClient.invalidateQueries({ queryKey: ["orders"] })` após um POST/PUT/DELETE refaz só as queries que importam.
- **Mutations** — `useMutation` com `onSuccess`/`onError` simplifica o controle de feedback (toast, notificação, etc.).
- **Stale-while-revalidate** — UX nunca trava esperando fetch.

### Por que separar front e back em uma mesma codebase?

- **Stack compartilhada** (TypeScript) — tipos compartilhados (`Order`, `Customer`, etc) definidos uma vez em `src/ui/api.ts`.
- **Deploy único** — `npm run build` gera `dist/` (frontend) + `dist-server/` (backend) e Fastify serve ambos (em prod).
- **Refactor facilitado** — renomear `Order.saleDate` no backend força erro de tipo no frontend (TS pega).
- **Tradeoff:** monolito impede escalar equipes. Se virar SaaS com 100+ devs, separar faz sentido.

---

## Estado global vs local

| O que é local (useState) | O que é global (React Query) |
|---------------------------|------------------------------|
| View atual (`dashboard`/`orders`/...) | Listas de pedidos, clientes, produtos |
| Filtros de tabela | Status de auth |
| Modal aberto/fechado | Configurações do servidor (settings) |
| Hover/tooltip state | Catálogo de produtos e clientes (autocomplete) |
| Página atual (paginação) | Backups disponíveis |

A única "state global" fora do React Query é o **estado de auth** (no `App.tsx`), que controla se renderiza `<Setup>`, `<Login>` ou o app principal.

---

## Próximas evoluções (quando/escalável)

| Quando | Evolução | Esforço |
|--------|----------|---------|
| > 5k pedidos/mês | Migrar para `better-sqlite3` (ou PostgreSQL) | 1-2 semanas |
| Multi-usuário | Adicionar `user_id` em `orders`/`customers` e RBAC | 2-3 semanas |
| Mobile | PWA + offline-first sync | 3-4 semanas |
| Multi-loja real (franquia) | Schema multi-tenant com `tenant_id` | 1 mês |
| Integração com marketplaces | Webhooks Mercado Livre (em vez de upload) | 1 semana |
