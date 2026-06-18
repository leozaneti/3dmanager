# Rotas da API — `server/routes/`

Endpoints REST sob `/api/*`. Cada arquivo registra um conjunto de rotas em
uma única função `register*(app)` chamada por `server/index.ts`. Validação
de entrada é via Zod em todas as rotas de escrita.

## Índice

| Arquivo | Rotas | Responsabilidade |
|---------|-------|------------------|
| `orders.ts` | `/api/orders`, `/api/orders/:id`, `/api/orders/:id/status`, `/api/orders/bulk-delete`, `/api/orders/totals`, `/api/status-transitions` | CRUD de pedidos, transições de status (com auto-estorno "Devolvido zera"), KPIs agregados |
| `products.ts` | `/api/products`, `/api/products/:id`, `/api/products/:id/recalculate` | CRUD de produtos + recálculo retroativo de custo em pedidos |
| `customers.ts` | `/api/customers`, `/api/customers/:id`, `/api/customers/:id/summary`, `/api/customers/bulk-delete` | CRUD de clientes + agregação de summary (KPI por cliente) |
| `imports.ts` | `/api/imports/preview`, `/api/imports/validate`, `/api/imports/confirm`, `/api/imports/progress/:token`, `/api/imports/mp/preview`, `/api/imports/mp/confirm`, `/api/import-log` | Upload + preview + confirmação de XLSX do ML e CSV do MP. Jobs async com polling por `token` |
| `dashboard.ts` | `/api/dashboard` | Agregação de KPIs e série temporal para gráficos (diário/semanal/mensal automático) |
| `finance.ts` | `/api/transactions`, `/api/transactions/:id`, `/api/finance/categories`, `/api/finance/opening-balance`, `/api/finance/dre`, `/api/finance/totals` | Transações financeiras (receitas/despesas), categorias, DRE, saldo de abertura |
| `todos.ts` | `/api/todos`, `/api/todos/:id`, `/api/todo-columns` | Kanban: cards + colunas customizáveis |
| `admin.ts` | `/api/meta`, `/api/stores`, `/api/settings`, `/api/audit-log` | Meta info, lojas, configurações do sistema, log de auditoria |
| `auth.ts` | `/api/auth/setup`, `/api/auth/status`, `/api/auth/login`, `/api/auth/logout` | Autenticação por senha (rate limit 5/15min no login) |
| `backups.ts` | `/api/backups`, `/api/backups` (POST) | Listagem e trigger de backup manual |
| `helpers.ts` | — | Wrappers SQL (`all`, `get`, `cents`, `optionalId`, `boolRow`) |

## Onde mora cada regra

- **"Devolvido zera"** (RN04) → `server/financials.ts` é a fonte da verdade. Aplicada em 3 pontos:
  - `orders.ts` (PUT `/api/orders/:id/status`)
  - `importer.ts` (insert + update no reimport ML)
  - `importerMp.ts` (atualiza `other_costs_cents` em estornos MP)
- **Cálculo financeiro de pedido** → `server/calculations.ts` (função pura, sem I/O)
- **Transições de status** → `server/statusConfig.ts` (`STATUS_TRANSITIONS`)
- **Deduplicação de cliente** → `server/importer.ts` (`ensureCustomer`)

## Convenção de query params

Filtros de listagem aceitam `from`, `to` (ISO date), `customerId`, `storeId`,
`channelId`, `statusId`, `search` (LIKE em vários campos), `sort`, `dir`,
`page`, `pageSize`. Helper que monta o `WHERE` está em `orders.ts:orderListWhere`.
