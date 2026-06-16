# Regras de Negócio — 3D Manager

> Sistema de gestão para e-commerce de impressão 3D.
> Versão: 0.4.0 | Última atualização: 16/06/2026

> Mudanças nesta versão: centralização da regra "Devolvido zera" em `server/financials.ts`. Módulo compartilhado `brazilianStates`. Remoção de duplicações em `index.ts` e `importer.ts`.

---

## Sumário

1. [Pedidos](#1-pedidos)
2. [Produtos](#2-produtos)
3. [Clientes](#3-clientes)
4. [Financeiro](#4-financeiro)
5. [Importação (Mercado Livre / Extrato MP)](#5-importação-mercado-livre--extrato-mp)
6. [DRE](#6-dre)
7. [Dashboard & KPIs](#7-dashboard--kpis)
8. [Backup](#8-backup)
9. [Kanban (To-Do)](#9-kanban-to-do)
10. [Autenticação](#10-autenticação)
11. [Auditoria](#11-auditoria)
12. [Configurações de Produção](#12-configurações-de-produção)

---

## 1. Pedidos

### RN01 – Ciclo de Vida do Pedido
```
Novo → Enviado → Entregue
                      ↓
               Devolvido

Cancelado e Devolvido são estados terminais.
```

> **Nota:** Os IDs dos status são dinâmicos (definidos pelo banco).
> Consulte `server/statusConfig.ts` e a tabela `order_statuses` para valores vigentes.
> O status "Produção" foi removido — pedidos que estavam nesse status foram
> rebaixados para "Novo".

### RN02 – Transições de Status Válidas

As transições são definidas por **nome** do status (não por ID numérico)
em `server/statusConfig.ts:STATUS_TRANSITIONS`:

| De | Para |
|----|------|
| Novo | Enviado, Cancelado, Devolvido |
| Enviado | Entregue, Cancelado, Devolvido |
| Entregue | Devolvido |
| Cancelado | (terminal) |
| Devolvido | (terminal) |

### RN03 – Unicidade de Pedido Externo
- `external_order_id` é único por par `(store_id, sales_channel_id)`.
- Se preenchido, não pode haver outro pedido com o mesmo valor na mesma loja + canal.

### RN04 – Auto-Estorno (Mercado Livre)
- Ao marcar um pedido do canal **Mercado Livre** como **Devolvido**, todos os valores financeiros são zerados:
  - `products_amount_cents = 0`
  - `shipping_total_cents = 0`
  - `shipping_customer_cents = 0`
  - `platform_fee_cents = 0`
  - `discount_cents = 0`
  - `other_costs_cents = 0`
  - `amount_received_cents = 0`
  - `packaging_cents = 0`
  - `additional_costs_cents = 0`
  - `cost_unit_cents` em `order_items` também é zerado.
- Na importação, pedidos com status Devolvido também recebem financeiros zerados.

> **Nota técnica:** A lógica "Devolvido zera" é centralizada em `server/financials.ts` (função `normalizeFinancialsForStorage` e `expectedFinancialsFor`). O endpoint de import (`importer.ts`) e o `PUT /api/orders/:id/status` (`index.ts`) usam o mesmo helper, evitando drift entre fluxos. Há 25 testes em `server/__tests__/financials.test.ts` cobrindo o comportamento.

### RN05 – Exclusão de Pedido
- Exclusão física (DELETE) com remoção em cascata de `order_items` e `order_financials`.

---

## 2. Produtos

### RN06 – Unicidade de SKU
- `sku` é campo `UNIQUE` na tabela `products`.

### RN07 – Cálculo de Custo de Produção
```
material      = (pesoGramas / 1000) × precoPLAPorKg
energia       = tempoImpressaoMin × (custoEnergiaHora / 60)
maquina       = tempoImpressaoMin × (valorImpressora / vidaUtilHoras / 60) × (1 + manutencao/100)
subtotal      = material + energia + maquina + custosAdicionais
custoErro     = subtotal × (taxaErro / 100)
custoTotal    = subtotal + custoErro
```

### RN08 – Recalculo Retroativo de Custo
- Ao editar um produto, é possível escolher entre:
  - **none**: não altera pedidos existentes
  - **from_date**: atualiza `cost_unit_cents` apenas em pedidos com `sale_date >= data escolhida`
  - **all**: atualiza `cost_unit_cents` em **todos** os pedidos que contêm o produto

### RN09 – Exclusão de Produto
- Anula `product_id` nos `order_items` (não remove os itens do pedido).
- A referência `product_id` em `order_items` é opcional (nullable).

---

## 3. Clientes

### RN10 – Deduplicação
- Primeiro critério: `document` (CPF/CNPJ).
- Segundo critério (fallback): par `(name, cep)`.

### RN11 – Merge de Dados na Importação
- Se cliente já existe por documento, mas possui campos vazios (nome, endereço etc.), esses campos são preenchidos com os dados do arquivo importado.

### RN12 – Exclusão de Cliente
- `customer_id` nos pedidos é setado para `NULL` (não exclui os pedidos).

---

## 4. Financeiro

### RN13 – Armazenamento em Centavos
- Todo valor monetário é armazenado como `INTEGER` em centavos (sufixo `Cents`).

### RN14 – Cálculos Financeiros por Pedido

```
subsidioFrete      = freteTotal - freteRecebido
receitaBruta       = valorProdutos + freteRecebido
custoOperacional   = taxaPlataforma + freteTotal + outrosCustos + embalagem + custosAdicionais - desconto
receitaLiquida     = receitaBruta - custoOperacional
lucro              = receitaLiquida - custoItens
margem%            = (lucro / receitaBruta) × 100
resultadoVenda     = receitaBruta - taxaPlataforma - freteTotal - outrosCustos + desconto
```

### RN15 – Embalagem como Custo Padrão
- O custo de embalagem é lido da configuração `packaging_cost` e pré-preenchido em novos pedidos.

## 5. Importação (Mercado Livre / Extrato MP)

### RN16 – Fluxo em Duas Fases
1. **Preview**: upload do XLSX → análise → exibição de duplicatas, SKUs faltantes e alterações detectadas
2. **Confirmação**: executa a importação com base nos dados cacheados (cache expira em 30 min)

### RN17 – Mapeamento de Status ML → Interno
| Texto no XLSX | Status Interno |
|---|---|
| "devolvido" / "devolução" | Devolvido |
| "cancelado" / "cancelada" | Cancelado |
| "entregue" | Entregue |
| "enviado" / "a caminho" / "tentaremos" / "não" + "entrega" | Enviado |
| "produção" / "preparando" | Novo (status removido, rebaixado para Novo) |
| *outros* | Novo (default) |

### RN18 – Pacote de Diversos (Bundle)
- Linhas com "Pacote de diversos" são agregadas em um único pedido.
- O status final do pacote é o **menos avançado** entre todos os itens (abordagem conservadora).

### RN19 – Cálculo de Cupom na Importação
```
gap = total - (receitaProdutos + freteRecebido + tarifaPlataforma + freteTotal + desconto)
cupom = gap < 0 ? |gap| : 0
```
O cupom é armazenado em `other_costs_cents`.

### RN36 – Importação de Extrato MP (CSV)
- Fluxo em duas fases: **Preview** (upload CSV → análise) e **Confirmar** (execução).
- Arquivo: CSV separado por `;` com colunas padronizadas (SOURCE_ID, REAL_AMOUNT, SETTLEMENT_DATE, PACK_ID, etc.).
- Cache de preview expira em 10 minutos.

### RN37 – Filtro de Transações MP
| Transaction Type | REAL_AMOUNT | Ação |
|---|---|---|
| SETTLEMENT | > 0 | Income "Vendas" |
| SETTLEMENT_SHIPPING | > 0 | Income "Vendas" |
| DISPUTE / DISPUTE_SHIPPING | < 0 | Expense "Estorno/Reembolso" |
| Qualquer | > 0 e SOURCE_ID em DISPUTE | Ignorado (reversão de chargeback) |
| Sem PACK_ID e sem ORDER_ID | qualquer | Ignorado (asset management) |

### RN38 – Deduplicação (MP)
- Chave única: `(source_id, amount_cents, type)` na tabela `transactions`.
- Se `source_type = 'mp_settlement'` e a combinação já existir, a linha é ignorada.
- Permite re-importar o mesmo CSV sem criar duplicatas.

### RN39 – Link PACK_ID/ORDER_ID
1. **PACK_ID** → `orders.external_order_id` (match exato)
2. Fallback: **ORDER_ID** → `orders.external_order_id`
3. Sem match → transação criada como "Venda externa" (sem `transaction_orders`), entra em `otherIncome` no DRE
4. O vínculo existe apenas para marcar o pedido como "realizado" — os valores do `order_financials` não são alterados

### RN41 – Expected no Preview do Import MP
- O preview compara `REAL_AMOUNT` (CSV) contra o **Resultado da Venda** do pedido (vide RN14).
- **ML**: `REAL_AMOUNT` já é o líquido → expected ≈ received
- **Não-ML via MP**: `REAL_AMOUNT` é o valor bruto → divergência esperada (frete/taxas viram despesas separadas)

---

## 6. DRE (Demonstração de Resultados)

### RN20 – Receita via Transações Financeiras
- **Realizado**: pedidos Entregues **com** ao menos uma transação de receita vinculada → receita = soma dos `amount_cents` dessas transações (o valor real que entrou na conta).
- **A Realizar (estimado)**: pedidos Entregues **sem** transação de receita → receita estimada via `order_financials`:
  ```
  receitaEstimada = products + shipping_customer - shipping_total - plataforma - outros_custos + desconto
  ```
  Corresponde ao **Resultado da Venda** (valor líquido após fretes, taxas e descontos).

### RN21 – Estrutura do DRE

```
(+) Receita de vendas (realizada + estimada)
(-) Custo dos produtos          ← order_items
(-) Embalagens                  ← order_financials.packaging_cents
(-) Custos adicionais da venda  ← order_financials.additional_costs + other_costs
(-) Despesas variáveis          ← transactions expense cost_type=variable
= MARGEM DE CONTRIBUIÇÃO
(-) Despesas fixas              ← transactions expense cost_type=fixed
(+) Outras receitas             ← transactions income (category≠Vendas OU não linkada)
= RESULTADO LÍQUIDO
```

- **Não** há mais linha de "Deduções variáveis (taxas, fretes, descontos)" — esses valores já são descontados na fonte pelo Mercado Pago, e o SETTLEMENT já reflete o líquido recebido.
- `additional_costs_cents` e `other_costs_cents` entram como custo direto da venda.

### RN42 – Alerta de Divergência
- Para todos os pedidos Entregues, compara:
  ```
  expected = Resultado da Venda = products + shipping_customer - shipping_total - plataforma - outros_custos + desconto
  received = soma líquida de todas as transações (income positivas + expense negativas) do pedido, ou 0 se não houver transações
  ```
- Se `|received - expected| > max(R$1,00, 5% de expected)`, o DRE exibe um banner de alerta.
- Casos detectados:
  - **Pedido sem nenhuma transação financeira** → `received=0, expected>0` → avisa que falta lançar receita
  - **ML**: income já vem líquido (≈ expected) → pouca ou nenhuma divergência
  - **Não-ML**: income é bruto + despesas negativas → `income + expense = expected` sem divergência
  - **Manual**: mesma lógica do não-ML

### RN43 – Classificação de Transações
- **income** (receita): Vendas, Estorno/Reembolso, Outras entradas
- **expense** (despesa): Impostos, Insumos, Energia, Marketing, Outros custos
- Despesas subclassificadas em `fixed` (fixas) e `variable` (variáveis)
- Categorias pré-cadastradas são fixas, mas o usuário pode criar novas.

### RN42 – Pedido Obrigatório em Transação de Venda
- Toda transação do tipo `income` e categoria `Vendas` deve ter ao menos um pedido vinculado.
- A validação ocorre no backend (POST/PUT `/api/transactions`) e no frontend (impede submit).
- O MP import não passa pela API, então criações via CSV não são afetadas.
- Casos sem match no MP viram "Venda externa" sem pedido, mas entram em `otherIncome` no DRE.

---

## 7. Dashboard & KPIs

### RN22 – Filtro Padrão
- Se nenhum período é informado, o dashboard filtra pelo mês corrente (`date('now', 'start of month')`).
- Pedidos com status **Devolvido** são sempre excluídos dos totais do dashboard.

### RN23 – Agrupamento Temporal (Auto)
| Período | Agrupamento |
|---|---|
| ≤ 30 dias | Diário |
| 31–90 dias | Semanal |
| > 90 dias | Mensal |

### RN24 – Comparação com Período Anterior
- Quando um período é selecionado, o dashboard calcula automaticamente os totais do período anterior equivalente (mesmo número de dias).

---

## 8. Backup

### RN25 – Backup Automático Diário
- Executa a cada hora via `setInterval`.
- Só cria backup se não existir um para a data atual.
- Armazenamento em `data/backups/backup-YYYY-MM-DD.sqlite`.

### RN26 – Política de Retenção
- Últimos 30 dias: mantém **todos** os backups diários.
- Períodos anteriores: mantém **apenas 1 backup por mês** (o mais recente).
- Arquivos fora do padrão `backup-YYYY-MM-DD.sqlite` são automaticamente removidos.

---

## 9. Kanban (To-Do)

### RN27 – Colunas Padrão
- Backlog, Fazendo, Pronto (sendo "Pronto" a coluna de conclusão).

### RN28 – Conclusão Automática
- Cards movidos para uma coluna com `is_done_column = true` recebem `done_at = timestamp atual`.

### RN29 – Proteção de Exclusão
- Não é possível excluir uma coluna que contenha cards (retorna HTTP 409).

### RN30 – Posicionamento Automático
- Novos cards e colunas são posicionados ao final (`position = max_position + 1`).

---

## 10. Autenticação

### RN31 – Opcional
- Habilitada via `AUTH_ENABLED=true` ou comando `npm run dev:auth`.
- Desabilitada por padrão.

### RN32 – Sessão com TTL
- Tokens: 32 bytes hex, armazenados em memória.
- TTL: 8 horas.
- Limpeza de sessões expiradas: a cada 1 hora.
- Login rate-limited: 5 tentativas a cada 15 minutos.

### RN33 – Setup Único
- Senha administrativa só pode ser configurada uma vez (retorna HTTP 409 se já existir).

---

## 11. Auditoria

### RN34 – Log Obrigatório
- Toda operação de Criação, Atualização ou Exclusão em entidades principais (pedidos, produtos, clientes, lojas, transações, cards, colunas) gera registro no `audit_log`.
- Cada registro contém: `action`, `entity`, `entity_id`, `description`, `created_at`.

---

## 12. Configurações de Produção

### RN35 – Valores Padrão

| Chave | Valor | Descrição |
|---|---|---|
| `pla_price_per_kg` | R$ 100,00 (10000¢) | Preço do PLA por kg |
| `energy_cost_per_hour` | R$ 0,10 (10¢) | Custo de energia por hora |
| `machine_value` | R$ 8.000,00 (800000¢) | Valor da impressora |
| `machine_lifespan_hours` | 3000h | Vida útil da máquina em horas |
| `maintenance_factor` | 10% | Fator de manutenção |
| `error_rate` | 10% | Taxa de erro na produção |
| `packaging_cost` | R$ 0,00 (0¢) | Custo de embalagem por pedido |
| `opening_balance_cents` | R$ 5.200,00 (520000¢) | Saldo inicial do financeiro |

---

## Referências Técnicas

| Arquivo | Conteúdo |
|---|---|
| `server/calculations.ts` | Fórmulas financeiras de pedido (grossRevenue, profit, margem) |
| `server/financials.ts` | ⭐ Regra "Devolvido zera" + cálculo de cupom + match product by title |
| `server/statusConfig.ts` | Transições de status, helpers `isDevolvido` / `getStatusId` |
| `server/brazilianStates.ts` | Lista de UFs + helpers `getStateName` / `getStateAbbreviation` |
| `server/importShared.ts` | Mapeamento de status ML → interno, normalização de acentos |
| `server/importer.ts` | Lógica de importação ML, merge de clientes, batch de orders |
| `server/importerMp.ts` | Parsing de CSV do Mercado Pago, preview, confirm, dedup |
| `server/xlsxParser.ts` | Parsing de XLSX do Mercado Livre, agregação de "Pacote de diversos" |
| `server/db.ts` | Schema do banco, migração, seed, backup automático |
| `server/index.ts` | Rotas da API, validações (zod) |
| `src/ui/ProductModal.tsx` | Calculadora de custo de produção |
| `src/ui/OrderModal.tsx` | Formulário de pedidos, autocomplete |
| `src/ui/OrderFinancialSidebar.tsx` | Sidebar com breakdown financeiro em cascata |
| `src/ui/finance.ts` | Re-export de `calculateOrderTotals` para o frontend |
| `src/shared/brazilianStates.ts` | Espelho de `server/brazilianStates.ts` para o frontend |
