import type { FastifyInstance } from "fastify";
import { calculateOrderTotals } from "../calculations.js";
import { getStatusId } from "../statusConfig.js";
import { all } from "./helpers.js";

function getDefaultGroupBy(startDate: string, endDate: string): "day" | "week" | "month" {
  const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days > 90) return "month";
  if (days > 30) return "week";
  return "day";
}

function dashboardTotals(conditions: string[], params: unknown[]) {
  const filters = [`o.status_id != ${getStatusId("devolvido")}`, ...conditions];
  const where = filters.length ? "where " + filters.join(" and ") : "";
  const rows = all(
    `select
      o.id, o.sale_date as saleDate, o.store_id as storeId, s.name as storeName, sc.name as channelName,
      of.products_amount_cents as productsAmountCents,
      of.shipping_total_cents as shippingTotalCents,
      of.shipping_customer_cents as shippingCustomerCents,
      of.platform_fee_cents as platformFeeCents,
      of.discount_cents as discountCents,
      of.other_costs_cents as otherCostsCents,
      of.amount_received_cents as amountReceivedCents,
      of.packaging_cents as packagingCents,
      of.additional_costs_cents as additionalCostsCents,
      coalesce(sum(oi.quantity * oi.cost_unit_cents), 0) as itemsCostCents,
      coalesce(sum(oi.quantity), 0) as totalItems
    from orders o
    join stores s on s.id = o.store_id
    join sales_channels sc on sc.id = o.sales_channel_id
    join order_financials of on of.order_id = o.id
    left join order_items oi on oi.order_id = o.id
    ${where}
    group by o.id`,
    params
  ) as any[];
  const totals = rows.reduce(
    (acc, row) => {
      const calc = calculateOrderTotals(row);
      acc.orderCount += 1;
      acc.grossRevenueCents += calc.grossRevenueCents;
      acc.netRevenueCents += calc.netRevenueCents;
      acc.saleResultCents += calc.saleResultCents;
      acc.profitCents += calc.profitCents;
      acc.itemsCostCents += calc.itemsCostCents;
      acc.shippingCustomerCents += row.shippingCustomerCents;
      acc.shippingSubsidyCents += calc.shippingSubsidyCents;
      acc.totalItems += row.totalItems;
      acc.marginPercent = acc.grossRevenueCents ? (acc.profitCents / acc.grossRevenueCents) * 100 : 0;
      acc.totalCostCents = acc.itemsCostCents + (acc.grossRevenueCents - acc.netRevenueCents);
      acc.avgTicketCents = acc.orderCount ? Math.round(acc.grossRevenueCents / acc.orderCount) : 0;
      return acc;
    },
    { orderCount: 0, grossRevenueCents: 0, netRevenueCents: 0, saleResultCents: 0, profitCents: 0, itemsCostCents: 0, shippingCustomerCents: 0, shippingSubsidyCents: 0, totalItems: 0, totalCostCents: 0, avgTicketCents: 0, marginPercent: 0 }
  );
  return { rows, totals };
}

export default function registerDashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", (request) => {
    const query = request.query as Record<string, unknown>;
    const startDate = query.startDate ? String(query.startDate) : null;
    const endDate = query.endDate ? String(query.endDate) : null;
    const storeId = query.storeId ? Number(query.storeId) : null;
    const allTime = query.allTime === "true";

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!allTime) {
      if (startDate) {
        conditions.push("date(o.sale_date) >= date(?)");
        params.push(startDate);
      } else {
        conditions.push("date(o.sale_date) >= date('now', 'start of month')");
      }
      if (endDate) {
        conditions.push("date(o.sale_date) <= date(?)");
        params.push(endDate);
      }
    }
    if (storeId) {
      conditions.push("o.store_id = ?");
      params.push(storeId);
    }

    const dashboardConditions = [`o.status_id != ${getStatusId("devolvido")}`, ...conditions];
    const whereClause = dashboardConditions.length ? "where " + dashboardConditions.join(" and ") : "";

    const { rows: orderRows, totals } = dashboardTotals(conditions, params);

    let previousTotals = null;
    if (!allTime && startDate && endDate) {
      const days = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (days > 0) {
        const prevStart = new Date(new Date(startDate).getTime() - days * 24 * 60 * 60 * 1000)
          .toISOString().split("T")[0];
        const prevEnd = new Date(new Date(endDate).getTime() - days * 24 * 60 * 60 * 1000)
          .toISOString().split("T")[0];
        const prevConditions: string[] = [
          "date(o.sale_date) >= date(?)",
          "date(o.sale_date) <= date(?)"
        ];
        const prevParams: unknown[] = [prevStart, prevEnd];
        if (storeId) {
          prevConditions.push("o.store_id = ?");
          prevParams.push(storeId);
        }
        previousTotals = dashboardTotals(prevConditions, prevParams).totals;
      }
    }

    const productRows = all(
      `select
        coalesce(p.name, oi.listing_title, oi.sku, 'Sem produto') as name,
        sum(oi.quantity) as quantity,
        sum(oi.quantity * oi.sale_unit_price_cents) as revenueCents,
        sum(oi.quantity * (oi.sale_unit_price_cents - oi.cost_unit_cents)) as profitCents
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = oi.product_id
      ${whereClause}
      group by name
      order by quantity desc
      limit 8`,
      params
    );

    const channelRows = orderRows.reduce<Record<string, any>>((acc, row) => {
      const calc = calculateOrderTotals(row);
      const item = acc[row.channelName] ?? { name: row.channelName, orderCount: 0, grossRevenueCents: 0, profitCents: 0 };
      item.orderCount += 1;
      item.grossRevenueCents += calc.grossRevenueCents;
      item.profitCents += calc.profitCents;
      item.marginPercent = item.grossRevenueCents ? (item.profitCents / item.grossRevenueCents) * 100 : 0;
      acc[row.channelName] = item;
      return acc;
    }, {});

    const storeRows = orderRows.reduce<Record<string, any>>((acc, row) => {
      const calc = calculateOrderTotals(row);
      const item = acc[row.storeName] ?? { name: row.storeName, grossRevenueCents: 0, profitCents: 0 };
      item.grossRevenueCents += calc.grossRevenueCents;
      item.profitCents += calc.profitCents;
      acc[row.storeName] = item;
      return acc;
    }, {});

    const groupBy = (query.groupBy ? String(query.groupBy) : (endDate && startDate ? getDefaultGroupBy(startDate, endDate) : "day")) as "day" | "week" | "month";

    const timeSeriesRows = orderRows.reduce<Record<string, { period: string; revenueCents: number; profitCents: number; costsCents: number; orderCount: number }>>((acc, row) => {
      const calc = calculateOrderTotals(row);
      let period: string;
      if (groupBy === "week") {
        const d = new Date(row.saleDate + "T12:00:00");
        const dayNum = d.getDay() || 7;
        d.setDate(d.getDate() + 4 - dayNum);
        const yearStart = new Date(d.getFullYear(), 0, 1);
        const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        period = `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
      } else if (groupBy === "month") {
        period = String(row.saleDate).slice(0, 7);
      } else {
        period = String(row.saleDate).slice(0, 10);
      }
      const entry = acc[period] ?? { period, revenueCents: 0, profitCents: 0, costsCents: 0, orderCount: 0 };
      entry.revenueCents += calc.grossRevenueCents;
      entry.profitCents += calc.profitCents;
      entry.costsCents += calc.itemsCostCents + (calc.grossRevenueCents - calc.netRevenueCents);
      entry.orderCount += 1;
      acc[period] = entry;
      return acc;
    }, {});

    const timeSeries = Object.values(timeSeriesRows).sort((a, b) => a.period.localeCompare(b.period));

    if (timeSeries.length > 0 && !allTime && startDate && endDate) {
      const periodMap = new Map(timeSeries.map(d => [d.period, d]));
      const current = new Date(startDate + "T12:00:00");
      const end = new Date(endDate + "T12:00:00");
      while (current <= end) {
        let period: string;
        if (groupBy === "week") {
          const dayNum = current.getDay() || 7;
          const thurs = new Date(current);
          thurs.setDate(current.getDate() + 4 - dayNum);
          const yearStart = new Date(thurs.getFullYear(), 0, 1);
          const weekNum = Math.ceil((((thurs.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
          period = `${thurs.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
          current.setDate(current.getDate() + 7);
        } else if (groupBy === "month") {
          period = current.toISOString().slice(0, 7);
          current.setMonth(current.getMonth() + 1);
        } else {
          period = current.toISOString().slice(0, 10);
          current.setDate(current.getDate() + 1);
        }
        if (!periodMap.has(period)) {
          timeSeries.push({ period, revenueCents: 0, profitCents: 0, costsCents: 0, orderCount: 0 });
        }
      }
      timeSeries.sort((a, b) => a.period.localeCompare(b.period));
    }

    const allProductRows = productRows as any[];
    for (const p of allProductRows) {
      const revenue = p.revenueCents || 0;
      p.marginPercent = revenue ? ((p.profitCents || 0) / revenue) * 100 : 0;
    }

    return { totals, previousTotals, products: productRows, channels: Object.values(channelRows), stores: Object.values(storeRows), timeSeries };
  });
}
