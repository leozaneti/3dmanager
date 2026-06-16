import { useState, useMemo } from "react";

function getVal(obj: any, path: string) {
  return path.split(".").reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

export function useSort<T>(data: T[], defaultSort: string) {
  const [sortBy, setSortBy] = useState(defaultSort);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (key === sortBy) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    const list = [...data];
    list.sort((a, b) => {
      const va = getVal(a, sortBy);
      const vb = getVal(b, sortBy);
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, sortBy, sortDir]);

  return { sorted, sortBy, sortDir, handleSort };
}
