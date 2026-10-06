export function createStatisticsClient({ DEFAULT_STATISTICS_YEAR, ZONING_DEFAULTS, createBlankLanduseAreas, createZoningRow, form }) {
  return async function fetchLocalStatistics(address, request) {
    try {
      const response = await fetch("/api/local-statistics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, year: form.statisticsYear || DEFAULT_STATISTICS_YEAR }),
        signal: request.signal,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "KOSIS 자료를 추출하지 못했습니다.");
      }

      const patch = {
        researchSchemaVersion: 2,
        landuseAreas: createBlankLanduseAreas(),
        zoningRows: ZONING_DEFAULTS.map((name) => createZoningRow({ name })),
        landuseSourceTotal: null,
        zoningSourceTotal: null,
        landuseBaseYear: "",
        zoningBaseYear: "",
        statisticsDataKey: "",
      };
      const messages = [];
      if (payload.debug) {
        console.info("[TIA KOSIS extraction debug]", payload.debug);
      }
      patch.reportStatus = payload.extraction?.status || "";
      patch.statisticsEvidence = { landuse: payload.debug?.landuse?.conversion_log || [], zoning: payload.debug?.zoning?.conversion_log || [], retrievedAt: new Date().toISOString() };

      if (payload.landuse?.areas) {
        patch.landuseAreas = { ...createBlankLanduseAreas(), ...payload.landuse.areas };
        patch.landuseSourceTotal = payload.landuse.total;
        patch.landuseSource = payload.landuse.source || "";
        patch.landuseBaseYear = payload.landuse.tableBaseYear || payload.landuse.year || "";
        patch.statisticsDataKey = `kosis-landuse:${payload.landuse.regionName || payload.target}:${payload.landuse.year || ""}`;
        messages.push(`지목별 토지이용은 ${payload.landuse.regionName || payload.target} KOSIS ${payload.landuse.year || "수록기간"} 자료로 채웠습니다.`);
      }

      if (Array.isArray(payload.zoning?.rows) && payload.zoning.rows.length) {
        patch.zoningRows = payload.zoning.rows.map((row) => createZoningRow(row));
        patch.zoningSourceTotal = payload.zoning.total;
        patch.zoningSource = payload.zoning.source || "";
        patch.zoningBaseYear = payload.zoning.tableBaseYear || payload.zoning.year || "";
        patch.statisticsDataKey = patch.statisticsDataKey || `kosis-zoning:${payload.zoning.regionName || payload.target}:${payload.zoning.year || ""}`;
        messages.push(`용도지역은 ${payload.zoning.regionName || payload.target} KOSIS ${payload.zoning.year || "수록기간"} 자료로 채웠습니다.`);
      }
      patch.statisticsVerification = payload.extraction || payload.verification || null;
      if (patch.statisticsVerification?.message) {
        messages.push(patch.statisticsVerification.message);
      }

      if (!messages.length) {
        return {
          patch: {
            reportStatus: payload.extraction?.status || "DATA_NOT_FOUND",
            statisticsVerification: payload.extraction || payload.verification || {
              status: "DATA_NOT_FOUND",
              message: "KOSIS에서 자동 채움 가능한 토지이용/용도지역 자료를 찾지 못했습니다.",
            },
          },
          message: "KOSIS에서 자동 채움 가능한 토지이용/용도지역 자료를 찾지 못했습니다.",
        };
      }

      return { patch, message: messages.join(" ") };
    } catch (error) {
      console.error(error);
      const message = error.message || "KOSIS 자동 추출에 실패했습니다. 환경변수 KOSIS_API_KEY와 선택한 수록기간을 확인해 주세요.";
      return {
        patch: {
          reportStatus: "FAILED",
          statisticsVerification: {
            status: "FAILED",
            message,
            source: "KOSIS OpenAPI",
          },
        },
        message,
      };
    }
  };
}
