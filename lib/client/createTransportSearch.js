import { loadGyeonggiStationRoutes, loadSubwayDetails, transportScopeKey, needsGyeonggiRouteDetail, needsRetryBusDetail, busGapSummary } from "./transportEnrichment.js";

export function createTransportSearch({ computeRectangleBounds, createBlankPublicTransportResult, detectSurveyRegion, form, formatNumber, getScopeDimensions, loadBusDetails, markPendingBusDetails, requestGateRef, resolveScopeCenter, safe, setForm, setStatusText, toNumber }) {
  return async function searchPublicTransportFacilities(options = {}) {
    const request = requestGateRef.current.start("transport");
    const address = safe(options.address ?? form.basics.siteAddress);
    const { width, height } = options.width && options.height
      ? { width: toNumber(options.width), height: toNumber(options.height) }
      : getScopeDimensions(form.basics);

    if (!address) {
      setStatusText("대중교통/교통시설 현황을 조회하려면 주소지를 먼저 입력해 주세요.");
      setForm((current) => ({
        ...current,
        publicTransportResult: createBlankPublicTransportResult({
          searched: true,
          error: "주소지를 입력해 주세요.",
        }),
      }));
      return;
    }

    const region = detectSurveyRegion(address);
    if (!["seoul", "gyeonggi"].includes(region)) {
      if (options.auto) {
        setForm((current) => ({
          ...current,
          publicTransportResult: createBlankPublicTransportResult(),
        }));
        return;
      }

      setStatusText("대중교통/교통시설 자동 조회는 현재 서울·경기 주소지를 지원합니다.");
      setForm((current) => ({
        ...current,
        publicTransportResult: createBlankPublicTransportResult({
          searched: true,
          error: "서울·경기 버스 및 지하철, 서울 따릉이를 지원합니다.",
        }),
      }));
      return;
    }

    if (width <= 0 || height <= 0) {
      setStatusText("가로와 세로 범위를 모두 1m 이상으로 입력해 주세요.");
      return;
    }

    const retry = options.retryMissing === true;
    const previous = form.publicTransportResult || {};
    const scopeKey = transportScopeKey(address, width, height);
    if (retry && (previous.scopeKey !== scopeKey || !previous.scope)) {
      setStatusText("조사 조건이 달라졌거나 이전 범위가 없습니다. 교통시설 조회를 먼저 실행해 주세요.");
      return;
    }
    setStatusText(retry ? "성공 결과는 유지하고 누락 항목만 다시 조회합니다. API 재조회 대기 중인 항목은 잠시 후 시도해 주세요." : "조사 범위 안의 버스정류장·지하철역·따릉이를 조회하는 중입니다.");
    setForm((current) => ({
      ...current,
      publicTransportResult: retry ? { ...current.publicTransportResult, loading: true } : createBlankPublicTransportResult({ loading: true, searched: true }),
    }));

    try {
      const center = retry ? previous.scope.center : await resolveScopeCenter(options.center, request);
      if (!request.current()) return;
      const bounds = computeRectangleBounds(center.lat, center.lng, width, height);
      const requestBody = JSON.stringify({
        center,
        bounds,
        width,
        height,
      });
      const [bikeSettled, busSettled, subwaySettled] = await Promise.allSettled([
        retry ? Promise.resolve({ stations: previous.bikeStations, summary: previous.summary, source: previous.source, sourceUrl: previous.sourceUrl }) : region !== "seoul" ? Promise.resolve(null) : fetch("/api/seoul-bike", {
          signal: request.signal,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        }).then(async (response) => {
          const result = await response.json();
          if (!response.ok || !result.success) {
            throw new Error(result.message || "따릉이 대여소 조회에 실패했습니다.");
          }
          return result;
        }),
        retry && previous.busSummary ? Promise.resolve({ busStops: previous.busStops, summary: previous.busSummary, source: previous.busSource,
          sourceUrl: previous.busSourceUrl, fetchedAt: previous.busFetchedAt, sourceDate: previous.busSourceDate, cacheInfo: previous.busCacheInfo, sourceRetrievedAt: previous.busSourceRetrievedAt, refresh: previous.busRefresh }) : fetch(region === "seoul" ? "/api/seoul-bus" : "/api/gyeonggi-bus", {
          signal: request.signal,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        }).then(async (response) => {
          const result = await response.json();
          if (!response.ok || !result.success) {
            throw new Error(result.message || "버스정류장 조회에 실패했습니다.");
          }
          return result;
        }),
        retry && previous.subwaySource ? Promise.resolve({ stations: previous.subwayStations, source: previous.subwaySource, cacheInfo: previous.subwayCacheInfo, truncated: previous.subwayTruncated }) : fetch("/api/subway", { signal: request.signal, method: "POST", headers: { "Content-Type": "application/json" }, body: requestBody })
          .then(async (response) => {
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || "지하철역 조회 실패");
            return result;
          }),
      ]);

      if (!request.current()) return;
      const bikeResult = bikeSettled.status === "fulfilled" ? bikeSettled.value : null;
      const busResult = busSettled.status === "fulfilled" ? busSettled.value : null;
      const subwayResult = subwaySettled.status === "fulfilled" ? subwaySettled.value : null;
      const subwayError = subwaySettled.status === "rejected" ? subwaySettled.reason?.message || "지하철 조회 실패" : "";
      const bikeError = bikeSettled.status === "rejected" ? bikeSettled.reason?.message || "따릉이 대여소 조회에 실패했습니다." : "";
      const busError = busSettled.status === "rejected" ? busSettled.reason?.message || "버스정류장 조회에 실패했습니다." : "";

      if (!bikeResult && !busResult && !subwayResult) {
        throw new Error([bikeError, busError, subwayError].filter(Boolean).join(" / ") || "대중교통/교통시설 조회에 실패했습니다.");
      }

      setForm((current) => request.current() ? ({
        ...current,
        publicTransportResult: {
          scopeKey, scope: { center, bounds, width, height },
          bikeStations: bikeResult?.stations || [],
          busStops: busResult?.busStops || [],
          summary: bikeResult?.summary || null,
          busSummary: busResult?.summary || null,
          searched: true,
          loading: false,
          error: retry ? previous.error : region === "seoul" ? bikeError : "따릉이는 서울 지역만 지원합니다.",
          busError,
          transportRegion: region,
          subwayStations: subwayResult?.stations || [], subwaySource: subwayResult?.source || "", subwayError, subwayCacheInfo: subwayResult?.cacheInfo,
          subwayTruncated: Boolean(subwayResult?.truncated), subwayDetailLoading: Boolean(subwayResult?.stations?.length),
          source: bikeResult?.source || "",
          sourceUrl: bikeResult?.sourceUrl || "",
          busSource: busResult?.source || "",
          busSourceUrl: busResult?.sourceUrl || "",
          busFetchedAt: busResult?.fetchedAt || "",
          busSourceDate: busResult?.sourceDate || "",
          busCacheInfo: busResult?.cacheInfo,
          busSourceRetrievedAt: busResult?.sourceRetrievedAt || "",
          busRefresh: busResult?.refresh || null,
        },
      }) : current);

      setStatusText(
        `조사 범위 안의 버스정류장 ${formatNumber(busResult?.summary?.returnedCount || 0)}개, 지하철역 ${formatNumber(subwayResult?.stations?.length || 0)}개를 확인했습니다. 상세정보를 추가 조회합니다.`,
      );
      const subwayDetails = loadSubwayDetails({ stations: subwayResult?.stations || [], scope: { center, bounds, width, height }, request,
        onProgress: progress => setForm(current => request.current() ? ({ ...current, publicTransportResult: { ...current.publicTransportResult,
          subwayStations: progress.stations, subwayDetailLoading: progress.loading } }) : current),
      }).catch(() => {
        setForm(current => request.current() ? ({ ...current, publicTransportResult: { ...current.publicTransportResult,
          subwayDetailLoading: false, subwayError: "지하철 보완 조회 중단. 성공 결과는 유지합니다." } }) : current);
      });
      if (busResult?.busStops?.length) {
        try {
          let stations = busResult.busStops;
          if (region === "gyeonggi") stations = await loadGyeonggiStationRoutes({ stations, scope: { center, bounds, width, height }, request,
            onProgress: progress => setForm(current => request.current() ? ({ ...current, publicTransportResult: { ...current.publicTransportResult,
              busStops: progress.stations, busRouteLoading: progress.loading, busRouteCompleted: progress.completed, busRouteTotal: progress.total, busRouteError: progress.error,
              busSummary: busGapSummary(progress.stations, current.publicTransportResult.busSummary),
            } }) : current),
          });
          if (!request.current()) return;
          await loadBusDetails({ stations, scope: { center, bounds, width, height }, request,
            endpoint: region === "seoul" ? "/api/seoul-bus/details" : "/api/gyeonggi-bus/details",
            needsDetail: route => retry ? needsRetryBusDetail(route, region) : region === "seoul" || needsGyeonggiRouteDetail(route),
            onProgress: (progress) => setForm((current) => request.current() ? ({
              ...current,
              publicTransportResult: { ...current.publicTransportResult,
                busStops: progress.stations, busDetailLoading: progress.loading,
                busDetailCompleted: progress.completed, busDetailTotal: progress.total, busDetailError: progress.error,
                busSummary: busGapSummary(progress.stations, current.publicTransportResult.busSummary),
              },
            }) : current),
          });
        } catch {
          if (!request.current()) return;
          setForm((current) => request.current() ? ({ ...current,
            publicTransportResult: { ...current.publicTransportResult,
              busStops: markPendingBusDetails(current.publicTransportResult.busStops, "상세조회 처리 중단"),
              busDetailLoading: false, busRouteLoading: false, busDetailError: "상세정보 처리에 실패했습니다. 기본 목록은 유지합니다.",
            },
          }) : current);
        }
      }
      await subwayDetails;
    } catch (error) {
      if (!request.current()) return;
      console.error(error);
      setForm((current) => ({
        ...current,
        publicTransportResult: retry ? { ...current.publicTransportResult, loading: false, busRouteLoading: false, busDetailLoading: false, subwayDetailLoading: false,
          busDetailError: "누락 항목 재시도 실패. 기존 결과는 유지합니다." } : createBlankPublicTransportResult({
          searched: true,
          error: error.message || "대중교통/교통시설 조회에 실패했습니다.",
        }),
      }));
      setStatusText(error.message || "대중교통/교통시설 조회에 실패했습니다.");
    }
  };
}
