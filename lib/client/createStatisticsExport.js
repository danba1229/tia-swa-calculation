export function createStatisticsExport({ DEFAULT_STATISTICS_YEAR, buildExcelChartSheet, buildExcelReportSheet, deriveLocalStatisticsUnit, fitSheetColumns, form, landuseReportRows, setStatusText, zoningReportRows }) {
  return async function exportStep3Excel() {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const landuseSource = landuseReportRows[0]?.source || form.landuseSource || "";
      const zoningSource = zoningReportRows[0]?.source || form.zoningSource || "";
      const landuseSheetRows = buildExcelReportSheet("지목별 토지이용현황", landuseSource, landuseReportRows);
      const zoningSheetRows = buildExcelReportSheet("용도지역 현황", zoningSource, zoningReportRows);
      const landuseChartRows = buildExcelChartSheet(landuseReportRows);
      const zoningChartRows = buildExcelChartSheet(zoningReportRows);
      const landuseSheet = XLSX.utils.aoa_to_sheet(landuseSheetRows);
      const zoningSheet = XLSX.utils.aoa_to_sheet(zoningSheetRows);
      const landuseChartSheet = XLSX.utils.aoa_to_sheet(landuseChartRows);
      const zoningChartSheet = XLSX.utils.aoa_to_sheet(zoningChartRows);
      const maxColumnCount = Math.max(landuseReportRows.length, zoningReportRows.length) + 1;

      fitSheetColumns(landuseSheet, maxColumnCount);
      fitSheetColumns(zoningSheet, maxColumnCount);
      fitSheetColumns(landuseChartSheet, 3);
      fitSheetColumns(zoningChartSheet, 3);

      XLSX.utils.book_append_sheet(workbook, landuseSheet, "지목별 토지이용현황");
      XLSX.utils.book_append_sheet(workbook, zoningSheet, "용도지역 현황");
      XLSX.utils.book_append_sheet(workbook, landuseChartSheet, "그래프용_지목");
      XLSX.utils.book_append_sheet(workbook, zoningChartSheet, "그래프용_용도지역");
      const evidence = form.statisticsEvidence;
      if (evidence) {
        const rows = [['표', '원자료항목', '수록연도', '원자료값', '원자료단위', '변환 m2', '변환 km2', '조회시각']];
        for (const kind of ['landuse', 'zoning']) for (const row of evidence[kind] || []) rows.push([kind, row.category, row.year, row.raw, row.sourceUnit, row.m2, row.km2, evidence.retrievedAt]);
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '원자료 단위변환');
      }

      const unitName = deriveLocalStatisticsUnit(form.basics.siteAddress, "대상지").replace(/[\\/:*?"<>|]/g, "");
      const year = form.statisticsYear || DEFAULT_STATISTICS_YEAR;
      XLSX.writeFile(workbook, `TIA_STEP3_${unitName}_${year}.xlsx`);
      setStatusText("지목별 토지이용현황과 용도지역 현황을 엑셀 파일로 출력했습니다. 원형그래프용 데이터 시트도 함께 포함했습니다.");
    } catch (error) {
      console.error(error);
      setStatusText("엑셀 파일을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
}
