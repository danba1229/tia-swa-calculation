export function createDevelopmentSearch({ createBlankDevelopmentResult, createBlankDevelopmentSearch, formatNumber, getDevelopmentPayload, resolveSite, requestGateRef, setForm, setStatusText, summarizeProjects }) {
  return async function searchDevelopmentPlans(options = {}) {
    const request = requestGateRef.current.start("development");
    let payload = getDevelopmentPayload();

    if (!payload.siteAddress) {
      setStatusText("주변지역 개발계획을 검색하려면 사업지 주소를 먼저 입력해 주세요.");
      setForm((current) => ({
        ...current,
        developmentResult: createBlankDevelopmentResult({
          searched: true,
          error: "사업지 주소를 입력해 주세요.",
        }),
      }));
      return;
    }

    setStatusText("주변 교통영향평가 후보사업을 조회하고 좌표를 계산하는 중입니다.");
    setForm((current) => ({
      ...current,
      developmentSearch: {
        ...createBlankDevelopmentSearch(),
        ...(current.developmentSearch || {}),
      },
      developmentResult: createBlankDevelopmentResult({ loading: true, searched: true }),
    }));

    let accumulated = [];
    try {
      const site = options.site || (resolveSite ? await resolveSite(request) : null);
      if (!request.current()) return;
      if (site) payload = getDevelopmentPayload(site.address);
      let offset = 0;
      let datasetId, sourcePage = 1, sourceSignature;
      const sourceKeys = new Set();
      const sourceWarnings = new Set();
      do {
        const response = await fetch("/api/tia/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, offset, datasetId, sourcePage, sourceSignature }),
          signal: request.signal,
        });
        const result = await response.json();
        if (!request.current()) return;

        if (!response.ok || !result.success) {
          throw new Error(result.message || "교통영향평가 API 호출 실패");
        }

        const source = result.sourcePagination;
        if (source && offset === 0) {
          if (sourceSignature && source.signature !== sourceSignature) throw new Error("수집 중 원자료가 변경됐습니다. 다시 검색해 주세요.");
          sourceSignature = source.signature;
          for (const key of source.projectKeys || []) {
            if (sourceKeys.has(key)) throw new Error("사업 원자료에 반복 페이지가 있습니다. 전체 결과가 아닙니다.");
            sourceKeys.add(key);
          }
          if (source.complete && sourceKeys.size !== source.totalCount) throw new Error("사업 원자료의 전체 건수가 일치하지 않습니다. 다시 검색해 주세요.");
        }
        accumulated = mergeStoredAndLive(accumulated, result.results || []).sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
        const results = accumulated;
        const summary = summarizeProjects(Math.max(results.length, result.summary?.totalRawCount || 0), results);
        const nextOffset = result.pagination?.nextOffset ?? null;
        if (nextOffset !== null && nextOffset <= offset) throw new Error("후보사업 조회가 진행되지 않았습니다. 다시 검색해 주세요.");
        datasetId = result.pagination?.datasetId;
        if (nextOffset === null && source?.nextPage) {
          if (source.nextPage <= sourcePage) throw new Error("원자료 수집이 진행되지 않았습니다.");
          sourcePage = source.nextPage;
          datasetId = undefined;
          offset = 0;
        } else offset = nextOffset;
        for (const warning of result.debug?.apiErrors || []) if (warning) sourceWarnings.add(warning);
        const warnings = [...sourceWarnings].join(" / ");
        const complete = offset === null;
        setForm((current) => request.current() ? ({
          ...current,
          developmentResult: {
            site: result.site,
            summary,
            results,
            progress: source ? `원자료 ${source.processedPage || 0}/${source.totalCount ?? "미확인"}건 확인 · 지역 후보 ${results.length}건 좌표 조사` : `${result.pagination?.processedCount ?? results.length} / ${result.pagination?.candidateCount ?? results.length}건 좌표 조사`,
            complete,
            warnings,
            noticeSearches: result.noticeSearches || [],
            dataMode: result.dataMode || "",
            dbConfigured: Boolean(result.dbConfigured),
            searched: true,
            loading: !complete,
            error: "",
          },
        }) : current);
        setStatusText(complete
          ? `수집된 후보 중 ${formatNumber(summary.withinRadiusCount)}건이 사각형 조사 범위 안에 있습니다.${warnings ? " 일부 출처 조회가 실패하여 전체 결과가 아닐 수 있습니다." : ""}`
          : `주변사업 ${results.length}건 조사 중입니다. 아직 최종 결과가 아닙니다.`);
      } while (offset !== null && request.current());
    } catch (error) {
      if (!request.current()) return;
      console.error(error);
      setForm((current) => ({
        ...current,
        developmentResult: {
          ...current.developmentResult,
          searched: true,
          loading: false,
          complete: false,
          error: `조사 미완료: ${error.message || "교통영향평가 API 호출 실패"}. 현재 결과만으로 주변사업 부재를 판단할 수 없습니다.`,
        },
      }));
      setStatusText(error.message || "주변지역 개발계획 조회에 실패했습니다.");
    }
  };
}
import { mergeStoredAndLive } from '../tiaCoverage.js';
