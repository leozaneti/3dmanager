export interface DashboardTotals {
  orderCount: number;
  grossRevenueCents: number;
  netRevenueCents: number;
  saleResultCents: number;
  profitCents: number;
  itemsCostCents: number;
  shippingCustomerCents: number;
  shippingSubsidyCents: number;
  totalItems: number;
  totalCostCents: number;
  avgTicketCents: number;
  marginPercent: number;
}

export interface DashboardChannel {
  name: string;
  orderCount: number;
  grossRevenueCents: number;
  profitCents: number;
  marginPercent: number;
}

export interface DashboardProduct {
  name: string;
  quantity: number;
  revenueCents: number;
  profitCents: number;
  marginPercent: number;
}

export interface DashboardStore {
  name: string;
  grossRevenueCents: number;
  profitCents: number;
  marginPercent: number;
}

export interface DashboardTimePoint {
  period: string;
  revenueCents: number;
  profitCents: number;
  costsCents: number;
  orderCount: number;
}

export interface DashboardData {
  totals: DashboardTotals;
  previousTotals: DashboardTotals | null;
  channels: DashboardChannel[];
  products: DashboardProduct[];
  stores: DashboardStore[];
  timeSeries: DashboardTimePoint[];
}
