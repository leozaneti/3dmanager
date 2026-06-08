type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  hideWhenEmpty?: boolean;
};

export function Pagination({ page, pageSize, total, onPageChange, itemLabel = "itens", hideWhenEmpty = true }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (hideWhenEmpty && total <= pageSize) return null;
  return (
    <div className="pagination">
      <button disabled={page === 0} onClick={() => onPageChange(page - 1)}>Anterior</button>
      <span>Página {page + 1} de {totalPages} ({total} {itemLabel})</span>
      <button disabled={(page + 1) * pageSize >= total} onClick={() => onPageChange(page + 1)}>Próximo</button>
    </div>
  );
}
