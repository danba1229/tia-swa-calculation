export function createDevelopmentSearch({ createBlankDevelopmentResult, createBlankDevelopmentSearch, formatNumber, getDevelopmentPayload, requestGateRef, setForm, setStatusText, summarizeProjects }) {
  return async function searchDevelopmentPlans() {
    const request = requestGateRef.current.start("development");
    const payload = getDevelopmentPayload();

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
      let offset = 0;
      let datasetId;
      do {
        const response = await fetch("/api/tia/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, offset, datasetId }),
          signal: request.signal,
        });
        const result = await response.json();
        if (!request.current()) return;

        if (!response.ok || !result.success) {
          throw new Error(result.message || "교통영향평가 API 호출 실패");
        }

        accumulated = [...accumulated, ...(result.results || [])].sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
        const results = accumulated;
        const summary = summarizeProjects(result.summary?.totalRawCount || 0, results);
        const nextOffset = result.pagination?.nextOffset ?? null;
        if (nextOffset !== null && nextOffset <= offset) throw new Error("후보사업 조회가 진행되지 않았습니다. 다시 검색해 주세요.");
        offset = nextOffset;
        datasetId = result.pagination?.datasetId;
        const warnings = (result.debug?.apiErrors || []).filter(Boolean).join(" / ");
        const complete = offset === null;
        setForm((current) => request.current() ? ({
          ...current,
          developmentResult: {
            site: result.site,
            summary,
            results,
            progress: `${result.pagination?.processedCount ?? results.length} / ${result.pagination?.candidateCount ?? results.length}건 좌표 조사`,
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
