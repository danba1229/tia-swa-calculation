// Supported reference years, not the current calendar year or publication year.
export const STATISTICS_YEAR_OPTIONS = Object.freeze(["2025", "2024", "2023", "2022", "2021"].sort((a, b) => Number(b) - Number(a)));
export const DEFAULT_STATISTICS_YEAR = STATISTICS_YEAR_OPTIONS[0];

export function restoreStatisticsYearSelection(saved = {}) {
  const year = String(saved.statisticsYear || "").trim();
  const filled = value => value !== null && value !== undefined && String(value).trim() !== "";
  const hasData = saved.statisticsDataKey || saved.landuseBaseYear || saved.zoningBaseYear
    || filled(saved.landuseSourceTotal) || filled(saved.zoningSourceTotal)
    || Object.values(saved.landuseAreas || {}).some(filled)
    || (saved.zoningRows || []).some(row => filled(row.area));
  // Before selection mode was saved, 2024 was the fixed application default.
  const manual = saved.statisticsYearMode === "manual" || (!saved.statisticsYearMode && year && year !== "2024");
  return {
    statisticsYear: /^\d{4}$/.test(year) && (manual || hasData) ? year : DEFAULT_STATISTICS_YEAR,
    statisticsYearMode: manual ? "manual" : "auto",
  };
}
