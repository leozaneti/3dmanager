import type { DatePreset } from "../hooks/useDatePresets";
import { dateRangeFor } from "../hooks/useDatePresets";

export type { DatePreset };

type DatePresetConfig = {
  key: DatePreset;
  label: string;
  /** Indica se esse preset representa "todo o histórico" (sem filtro de data) */
  isAllTime?: boolean;
};

const DEFAULT_PRESETS: DatePresetConfig[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "7D" },
  { key: "15d", label: "15D" },
  { key: "30d", label: "30D" },
  { key: "month", label: "Este mês" },
  { key: "lastmonth", label: "Mês passado" },
  { key: "all", label: "Todo período", isAllTime: true },
];

type DatePresetBarProps = {
  /** Preset atualmente ativo (opcional — usado para highlight do botão) */
  activePreset?: DatePreset;
  /** Callback ao clicar em um preset */
  onPresetChange: (preset: DatePreset) => void;
  /** Lista de presets a renderizar (default: DEFAULT_PRESETS) */
  presets?: DatePresetConfig[];
  /** Inputs manuais de data (controlados) */
  startDate?: string;
  endDate?: string;
  onStartDateChange?: (value: string) => void;
  onEndDateChange?: (value: string) => void;
  /** Largura máxima dos inputs (default: 130) */
  inputWidth?: number;
  /**
   * Se true, renderiza botão "all" como ativo quando `allTime` for true (em vez de comparar `activePreset`).
   * Útil quando o caller separa "all" como flag independente.
   */
  isAllTime?: boolean;
};

export function DatePresetBar({
  activePreset,
  onPresetChange,
  presets = DEFAULT_PRESETS,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  inputWidth = 130,
  isAllTime,
}: DatePresetBarProps) {
  return (
    <div className="date-filter">
      {presets.map((preset) => {
        const isActive = preset.isAllTime
          ? isAllTime === true
          : activePreset === preset.key;
        return (
          <button
            key={preset.key}
            type="button"
            className={isActive ? "active" : ""}
            onClick={() => onPresetChange(preset.key)}
          >
            {preset.label}
          </button>
        );
      })}
      {onStartDateChange && onEndDateChange && (
        <>
          <input
            type="date"
            value={startDate ?? ""}
            onChange={(e) => onStartDateChange(e.target.value)}
            style={{ width: inputWidth }}
          />
          <span style={{ color: "#888" }}>até</span>
          <input
            type="date"
            value={endDate ?? ""}
            onChange={(e) => onEndDateChange(e.target.value)}
            style={{ width: inputWidth }}
          />
        </>
      )}
    </div>
  );
}

export { dateRangeFor };
