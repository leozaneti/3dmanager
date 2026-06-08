<div align="center">
  <h1>3D Manager</h1>
  <p>Sistema de gestão para loja de impressão 3D</p>
  <p>
    <strong>React</strong> · <strong>Fastify</strong> · <strong>SQLite</strong> · <strong>TypeScript</strong>
  </p>
</div>

---

## Funcionalidades

- **Dashboard** — KPIs de faturamento, margem, ticket médio e lucro com filtros por data
- **Pedidos** — CRUD completo com integração financeira (DRE), status por pipeline e vínculo com clientes/produtos
- **Importação** — Upload de planilha XLSX do Mercado Livre com parse automático, preview e confirmação em lote
- **Financeiro** — Lançamentos de receitas/despesas avulsas, categorização (fixo/variável), DRE realizado vs. pendente
- **Clientes** — Cadastro com histórico de pedidos, segmentação (novo, recorrente, ouro, inativo)
- **Produtos** — Cadastro com custo, peso, tempo de impressão e margem
- **Kanban** — Quadro de pedidos por status com drag-and-drop
- **Backup** — Script automatizado de backup do banco de produção
- **Autenticação** — Opcional, via sessão com senha hash

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18, Vite, TypeScript |
| Backend | Fastify, TypeScript |
| Banco | SQLite (sql.js) |
| Dashboard | Componentes próprios com KPIs e gráficos |
| Importação | xlsx (parse de planilhas) |

## Ambiente

O projeto usa bancos SQLite separados para desenvolvimento e produção, controlados pela variável `DB_ENV`.

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Sobe backend + frontend em modo dev (banco `dev.sqlite`) |
| `npm run build` | Compila TypeScript e empacota o frontend |
| `npm run start` | Sobe o servidor de produção (banco `prod.sqlite`) |
| `npm run backup` | Faz backup do banco de produção |
| `npm run dev:auth` | Modo dev com autenticação habilitada |

## Fluxo de trabalho

Desenvolvimento na branch `dev`, produção na `main`. Antes de mergear `dev` → `main`, rode `npm run backup` para garantir um ponto de restauração.

---

<div align="center">
  <sub>Feito com PLA e filamento PETG</sub>
</div>
