import { useCallback } from "react";

export type DatePreset = "today" | "yesterday" | "7d" | "15d" | "30d" | "month" | "lastmonth" | "all";

export type DateRange = { startDate: string; endDate: string; allTime: boolean };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function shiftDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function rangeForPreset(preset: DatePreset): DateRange {
  const now = new Date();
  const today = todayStr();
  switch (preset) {
    case "today":
      return { startDate: today, endDate: today, allTime: false };
    case "yesterday":
      return { startDate: shiftDays(now, -1), endDate: shiftDays(now, -1), allTime: false };
    case "7d":
      return { startDate: shiftDays(now, -7), endDate: today, allTime: false };
    case "15d":
      return { startDate: shiftDays(now, -15), endDate: today, allTime: false };
    case "30d":
      return { startDate: shiftDays(now, -30), endDate: today, allTime: false };
    case "month":
      return { startDate: firstOfMonth(), endDate: today, allTime: false };
    case "lastmonth": {
      const y = now.getFullYear();
      const m = now.getMonth();
      const lastMonthStart = new Date(y, m - 1, 1);
      const lastMonthEnd = new Date(y, m, 0);
      return {
        startDate: lastMonthStart.toISOString().slice(0, 10),
        endDate: lastMonthEnd.toISOString().slice(0, 10),
        allTime: false,
      };
    }
    case "all":
      return { startDate: "", endDate: "", allTime: true };
  }
}

export function useDatePreset(preset: DatePreset): DateRange {
  return rangeForPreset(preset);
}

export function dateRangeFor(preset: DatePreset): DateRange {
  return rangeForPreset(preset);
}
