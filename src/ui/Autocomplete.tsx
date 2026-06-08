import { useState, useMemo, useRef, useEffect } from "react";

export type AutocompleteItem = {
  id: string | number;
  primary: string;
  secondary?: string;
  searchText?: string;
};

type AutocompleteProps = {
  items: AutocompleteItem[];
  value: string;
  onSelect: (item: AutocompleteItem) => void;
  placeholder?: string;
  maxItems?: number;
  allowCreate?: (query: string) => { label: string; onCreate: () => void } | null;
  emptyText?: string;
  className?: string;
  showSearchIcon?: boolean;
};

export function Autocomplete({
  items,
  value,
  onSelect,
  placeholder,
  maxItems = 20,
  allowCreate,
  emptyText = "Nenhum resultado",
  className = "",
  showSearchIcon = false,
}: AutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, maxItems);
    const q = query.toLowerCase();
    return items
      .filter((item) => (item.searchText ?? item.primary).toLowerCase().includes(q))
      .slice(0, maxItems);
  }, [items, query, maxItems]);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        return;
      }
    }
    const createOption = allowCreate?.(query);
    const total = filtered.length + (createOption ? 1 : 0);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < filtered.length) {
        e.preventDefault();
        onSelect(filtered[activeIndex]);
        setOpen(false);
      } else if (createOption && activeIndex === filtered.length) {
        e.preventDefault();
        createOption.onCreate();
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const secondaryClass = (secondary: string) =>
    secondary.startsWith("R$") ? "price-tag" : "sku-tag";

  return (
    <div className={"autocomplete-wrap " + className} ref={ref}>
      <input
        className="product-search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => { setOpen(true); }}
        onKeyDown={handleKeyDown}
      />
      {showSearchIcon && <span className="customer-search-icon">🔍</span>}
      {open && filtered.length > 0 && (
        <div className="autocomplete-dropdown">
          {filtered.map((item, idx) => (
            <div
              key={item.id}
              className={`autocomplete-item${idx === activeIndex ? " active" : ""}`}
              onClick={() => { onSelect(item); setOpen(false); }}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <span>{item.primary}</span>
              {item.secondary && <span className={secondaryClass(item.secondary)}>{item.secondary}</span>}
            </div>
          ))}
          {allowCreate?.(query) && (
            <div
              className={`autocomplete-item${activeIndex === filtered.length ? " active" : ""}`}
              onClick={() => { allowCreate(query)!.onCreate(); setOpen(false); }}
              onMouseEnter={() => setActiveIndex(filtered.length)}
              style={{ borderTop: "1px solid #eee", color: "#2563eb", fontWeight: 500 }}
            >
              {allowCreate(query)!.label}
            </div>
          )}
        </div>
      )}
      {open && query.trim() && filtered.length === 0 && (
        <div className="autocomplete-dropdown">
          {allowCreate?.(query) ? (
            <div
              className={`autocomplete-item${activeIndex === 0 ? " active" : ""}`}
              onClick={() => { allowCreate(query)!.onCreate(); setOpen(false); }}
              style={{ color: "#2563eb", fontWeight: 500 }}
            >
              {allowCreate(query)!.label}
            </div>
          ) : (
            <div className="autocomplete-empty">{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}
