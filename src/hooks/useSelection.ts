import { useState, useCallback } from "react";

export function useSelection<T extends { id: number | string }>(items: T[]) {
  const [selected, setSelected] = useState<Set<number | string>>(new Set());

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  const toggleAll = useCallback(() => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((item) => item.id)));
  }, [allSelected, items]);

  const toggleOne = useCallback((id: number | string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return { selected, allSelected, toggleAll, toggleOne, clear, count: selected.size };
}
