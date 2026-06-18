# Views — `src/ui/views/`

Páginas principais (stateful) renderizadas pelo `App.tsx` baseado na seleção
do sidebar. Cada view é auto-contida: gerencia seus próprios filtros, modal
aberto, e estado de seleção.

## Índice

| Arquivo | Responsabilidade |
|---------|------------------|
| `OrdersView.tsx` | Lista de pedidos com KPIs (faturamento, resultado, lucro, ticket médio), filtros por data/status/loja/canal, busca textual, sidebar financeiro em cascata, transições de status, modais de criar/editar/detalhe |
| `ProductsView.tsx` | Cadastro de produtos com SKU, peso, tempo de impressão, custo, e calculadora integrada (material + energia + máquina + taxa de erro). Recálculo retroativo de custo em pedidos |
| `CustomersView.tsx` | Cadastro de clientes com segmentação automática (Novo/Recorrente/Ouro/Inativo) por histórico de compras. Deduplicação por documento. Modal de detalhe com KPIs e histórico paginado de pedidos |
| `SettingsView.tsx` | Configurações: lojas, parâmetros do sistema, auditoria, listagem/restore de backups, configuração de senha (se auth habilitada) |

## Composição típica

```tsx
<>
  <PageHeader title="..." subtitle="..." />
  <div className="toolbar">
    <DatePresetBar ... />
  </div>
  <KpiCard ... /> ou <KpiHero ... />
  <Panel title="...">
    <Tabela ... />
    <Pagination ... />
  </Panel>
  {modalAberto && <Modal />}
</>
```

## Hooks compartilhados usados

- `useSort` — ordenação de tabelas
- `useSelection` — checkbox múltiplo (bulk delete)
- `useDeleteMutation` — wrapper de `useMutation` para DELETE
- `useDatePresets` — ranges de data (today/7d/30d/etc)
