export type Meta = {
  stores: { id: number; name: string; active: boolean }[];
  channels: { id: number; name: string; active: boolean }[];
  statuses: { id: number; name: string; sortOrder: number; isFinal: boolean }[];
};

export type Product = {
  id: number;
  name: string;
  sku: string;
  currentCostCents: number;
  active: boolean;
  weightGrams: number;
  printTimeMinutes: number;
  additionalCostCents: number;
  minSalePriceCents?: number;
  maxSalePriceCents?: number;
  minNetReceivedCents?: number;
};

export type Settings = Record<string, { value: string; description: string }>;

export type Paginated<T> = { data: T[]; total: number };

type FilterTotals = {
  orderCount: number;
  productsAmountCents: number;
  shippingCustomerCents: number;
  shippingTotalCents: number;
  platformFeeCents: number;
  otherCostsCents: number;
  discountCents: number;
  itemsCostCents: number;
  packagingCents: number;
  additionalCostsCents: number;
};

export type OrdersResponse = Paginated<any> & {
  activeTotal: number;
  filterTotals: FilterTotals;
  activeOrderCount: number;
  statusCounts: { id: number; name: string; count: number }[];
};

export type AuditLogEntry = {
  id: number;
  action: string;
  entity: string;
  entity_id: number | null;
  description: string;
  created_at: string;
};

export type Customer = {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  document?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  notes?: string;
  orderCount?: number;
  firstPurchase?: string | null;
  lastPurchase?: string | null;
  totalProductsAmountCents?: number;
  totalShippingCustomerCents?: number;
  totalShippingTotalCents?: number;
  totalPlatformFeeCents?: number;
  totalDiscountCents?: number;
  totalOtherCostsCents?: number;
  totalPackagingCents?: number;
  totalAdditionalCostsCents?: number;
  totalItemsCostCents?: number;
};

/**
 * Helper HTTP para chamadas à API do backend.
 * Adiciona `credentials: "include"` (cookies de sessão) e ajusta
 * `Content-Type` automaticamente: JSON se o body não for FormData.
 */
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null;
  const isFormData = options?.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(hasBody && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...options?.headers
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Erro na API");
  }

  return response.json();
}

/** Formata centavos (INTEGER) para exibição em BRL: 1999 → "R$ 19,99". */
export function money(cents?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format((cents ?? 0) / 100);
}

/**
 * Converte string monetária no formato brasileiro para centavos (INTEGER).
 * "19,99" → 1999. Remove separadores de milhar e trata vírgula como decimal.
 */
export function toCents(value: FormDataEntryValue | null) {
  const text = String(value ?? "0").replace(/\./g, "").replace(",", ".");
  const n = Number(text || 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Converte centavos para string decimal brasileira: 1999 → "19,99". */
export function fromCents(cents?: number) {
  return ((cents ?? 0) / 100).toFixed(2).replace(".", ",");
}

/** Converte data ISO (YYYY-MM-DD) para exibição no formato brasileiro (dd/mm/aaaa). */
export function fmtDate(iso: string) {
  if (!iso) return "-";
  const parts = iso.split("T")[0].split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}
