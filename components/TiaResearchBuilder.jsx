"use client";

import { useEffect, useRef, useState } from "react";
import seoulTopisPoints from "../app/seoul-topis-points.json";

const STORAGE_KEY = "tia-research-builder-next-v1";
const TOPIS_POINT_CACHE_KEY = "tia-topis-point-coordinates-v1";
const GYEONGGI_POINT_CACHE_KEY = "tia-gyeonggi-point-coordinates-v1";
const LANDUSE_CATEGORIES = ["전", "답", "임야", "대지", "도로", "하천", "학교", "공원", "기타"];
const ZONING_DEFAULTS = ["주거지역", "상업지역", "공업지역", "녹지지역", "관리지역", "기타"];
const ROAD_CLASSES = ["고속도로", "대로", "로"];
const SURVEY_TYPES = [
  { value: "time", label: "요일별 시간대별 교통량" },
  { value: "average", label: "요일별 평균 교통량" },
  { value: "none", label: "자료 없음" },
];
const CHART_COLORS = ["#0b4f8a", "#2f6fa5", "#5e90bb", "#8fb4d0", "#b7cbdd", "#d5dfeb", "#7f9c7a", "#c68f58", "#8a6b5c", "#b9a79d"];
const MANUAL_RESEARCH_PLACEHOLDER = "수동 조사필요";

function createBlankBasics() {
  return {
    siteAddress: "",
    rectWidth: "",
    rectHeight: "",
    centerLat: "",
    centerLng: "",
  };
}

function createBlankLanduseAreas() {
  return Object.fromEntries(LANDUSE_CATEGORIES.map((category) => [category, ""]));
}

function createRoadRow(overrides = {}) {
  return { roadClass: "고속도로", name: "", startAddress: "", endAddress: "", source: "", ...overrides };
}

function createSurveyRow(overrides = {}) {
  return {
    pointCode: "",
    pointName: "",
    jurisdiction: "",
    distanceKm: "",
    dataType: "time",
    note: "",
    source: "",
    sourceLink: "",
    downloadLink: "",
    ...overrides,
  };
}

function createZoningRow(overrides = {}) {
  return { name: "", area: "", ...overrides };
}

function createTrafficPlanRow(overrides = {}) {
  return { title: "", relatedPlan: "", description: "", source: "", ...overrides };
}

function createConstructionPlanRow(overrides = {}) {
  return { title: "", location: "", status: "", source: "", ...overrides };
}

function createBlankState() {
  return {
    basics: createBlankBasics(),
    roads: ROAD_CLASSES.map((roadClass) => createRoadRow({ roadClass })),
    surveyPoints: [createSurveyRow()],
    landuseSource: "",
    zoningSource: "",
    landuseAreas: createBlankLanduseAreas(),
    zoningRows: ZONING_DEFAULTS.map((name) => createZoningRow({ name })),
    trafficPlans: [createTrafficPlanRow()],
    constructionPlans: [createConstructionPlanRow()],
  };
}

function safe(value) {
  return String(value || "").trim();
}

function isFilled(value) {
  return safe(value) !== "";
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toSortableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : Number.MAX_SAFE_INTEGER;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(toNumber(value));
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "-";
  return `${num.toFixed(1)}%`;
}

function formatDistance(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}km` : "-";
}

function distanceBetweenKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a = (
    Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2
  );
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function surveyTypeLabel(type) {
  return SURVEY_TYPES.find((item) => item.value === type)?.label || SURVEY_TYPES[0].label;
}

function surveyPriority(type) {
  if (type === "time") return 1;
  if (type === "average") return 2;
  return 3;
}

function compareSurveyRows(a, b) {
  const priorityDiff = surveyPriority(a.dataType) - surveyPriority(b.dataType);
  if (priorityDiff !== 0) return priorityDiff;
  const distanceDiff = toSortableNumber(a.distanceKm) - toSortableNumber(b.distanceKm);
  if (distanceDiff !== 0) return distanceDiff;
  return safe(a.pointName).localeCompare(safe(b.pointName), "ko");
}

function isSurveyRowFilled(row) {
  return (
    isFilled(row.pointCode) ||
    isFilled(row.pointName) ||
    isFilled(row.jurisdiction) ||
    isFilled(row.distanceKm) ||
    row.dataType !== "time" ||
    isFilled(row.note) ||
    isFilled(row.source) ||
    isFilled(row.sourceLink) ||
    isFilled(row.downloadLink)
  );
}

function selectSurveyPoint(rows) {
  return rows
    .filter(isSurveyRowFilled)
    .slice()
    .sort(compareSurveyRows)[0] || null;
}

function buildAutoSurveyPoints(address, topisCandidates, gyeonggiCandidates, surveyRecommendations) {
  const region = detectSurveyRegion(address);

  if (region === "seoul" && topisCandidates.length) {
    return topisCandidates.map((candidate) => createSurveyRow({
      pointCode: candidate.code,
      pointName: candidate.name,
      jurisdiction: "서울특별시",
      distanceKm: Number.isFinite(candidate.distanceKm) ? candidate.distanceKm.toFixed(1) : "",
      dataType: "time",
      note: `서울 TOPIS 최근접 후보 / ${candidate.address}`,
      source: "서울시 TOPIS",
      sourceLink: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily",
      downloadLink: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolReport",
    }));
  }

  if (region === "gyeonggi" && gyeonggiCandidates.length) {
    return gyeonggiCandidates.map((candidate) => createSurveyRow({
      pointCode: candidate.pointCode,
      pointName: `${candidate.routeName} / ${candidate.sectionName}`,
      jurisdiction: candidate.jurisdiction,
      distanceKm: Number.isFinite(candidate.distanceKm) ? candidate.distanceKm.toFixed(1) : "",
      dataType: "time",
      note: `경기 GITS 근사 추천 / ${candidate.sectionName}`,
      source: "경기도교통정보시스템",
      sourceLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do",
      downloadLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/regularAverageTrafficVolumeByWeekday.do",
    }));
  }

  const jurisdiction = deriveJurisdictionName(address, "");
  return surveyRecommendations.map((recommendation) => createSurveyRow({
    jurisdiction,
    dataType: recommendation.dataType,
    note: recommendation.description,
    source: recommendation.source,
    sourceLink: recommendation.sourceLink,
    downloadLink: recommendation.downloadLink,
  }));
}

function buildStats(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const ratioMap = new Map();
  const rankMap = new Map();

  entries.forEach((entry) => {
    ratioMap.set(entry.key, total > 0 ? (entry.value / total) * 100 : 0);
  });

  entries
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .forEach((entry, index) => {
      rankMap.set(entry.key, index + 1);
    });

  return { entries, total, ratioMap, rankMap };
}

function computeLanduseStats(form) {
  return buildStats(LANDUSE_CATEGORIES.map((category) => ({
    key: category,
    label: category,
    value: toNumber(form.landuseAreas[category]),
  })));
}

function computeZoningStats(form) {
  return buildStats(form.zoningRows.map((row, index) => ({
    key: index,
    label: safe(row.name) || `용도지역 ${index + 1}`,
    value: toNumber(row.area),
  })));
}

function topLabels(entries, total) {
  return entries
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((entry) => `${entry.label} ${formatPercent(total > 0 ? (entry.value / total) * 100 : 0)}`)
    .join(", ");
}

function buildPieSlices(entries, total) {
  if (!total) return [];

  let offset = 0;
  return entries
    .filter((entry) => entry.value > 0)
    .map((entry, index) => {
      const ratio = entry.value / total;
      const slice = {
        ...entry,
        color: CHART_COLORS[index % CHART_COLORS.length],
        start: offset,
        end: offset + ratio,
        percent: ratio * 100,
      };
      offset += ratio;
      return slice;
    });
}

function pieBackground(slices) {
  if (!slices.length) {
    return "radial-gradient(circle at center, rgba(255,255,255,0.95) 0 34%, transparent 35%), conic-gradient(#d9d4cc 0turn 1turn)";
  }
  return `radial-gradient(circle at center, rgba(255,255,255,0.95) 0 34%, transparent 35%), conic-gradient(${slices.map((slice) => `${slice.color} ${slice.start}turn ${slice.end}turn`).join(", ")})`;
}

function mergeLoadedState(parsed) {
  const base = createBlankState();
  return {
    ...base,
    ...parsed,
    basics: { ...base.basics, ...(parsed.basics || {}) },
    landuseAreas: { ...base.landuseAreas, ...(parsed.landuseAreas || {}) },
    roads: Array.isArray(parsed.roads) && parsed.roads.length ? parsed.roads : base.roads,
    surveyPoints: Array.isArray(parsed.surveyPoints) && parsed.surveyPoints.length ? parsed.surveyPoints : base.surveyPoints,
    zoningRows: Array.isArray(parsed.zoningRows) && parsed.zoningRows.length ? parsed.zoningRows : base.zoningRows,
    trafficPlans: Array.isArray(parsed.trafficPlans) && parsed.trafficPlans.length ? parsed.trafficPlans : base.trafficPlans,
    constructionPlans: Array.isArray(parsed.constructionPlans) && parsed.constructionPlans.length ? parsed.constructionPlans : base.constructionPlans,
  };
}

export default function TiaResearchBuilder({ kakaoJsKey, embedded = false }) {
  const [form, setForm] = useState(createBlankState);
  const [statusText, setStatusText] = useState("초기 화면을 준비하는 중입니다.");
  const [mapStatus, setMapStatus] = useState('배포 환경에 카카오 지도 키를 설정한 뒤 "조사 시작" 버튼을 눌러 주세요.');
  const [topisCandidates, setTopisCandidates] = useState([]);
  const [topisStatus, setTopisStatus] = useState("");
  const [gyeonggiCandidates, setGyeonggiCandidates] = useState([]);
  const [gyeonggiStatus, setGyeonggiStatus] = useState("");
  const hydratedRef = useRef(false);
  const mapContainerRef = useRef(null);
  const mapRuntimeRef = useRef({
    sdkPromise: null,
    loadedKey: "",
    map: null,
    marker: null,
    rectangle: null,
    infoWindow: null,
    surveyMarkers: [],
    surveyOverlays: [],
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setForm(mergeLoadedState(JSON.parse(raw)));
      }
    } catch (error) {
      console.error(error);
    } finally {
      hydratedRef.current = true;
      setStatusText("초기 화면이 준비되었습니다.");
    }
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    if (!embedded || typeof window === "undefined") return undefined;

    const emitHeight = () => {
      window.parent.postMessage(
        {
          type: "tia-embed-height",
          height: document.documentElement.scrollHeight,
        },
        "*",
      );
    };

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(emitHeight);
    });

    resizeObserver.observe(document.body);
    window.addEventListener("load", emitHeight);
    window.addEventListener("resize", emitHeight);
    window.setTimeout(emitHeight, 120);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("load", emitHeight);
      window.removeEventListener("resize", emitHeight);
    };
  }, [embedded]);

  const landuseStats = computeLanduseStats(form);
  const zoningStats = computeZoningStats(form);
  const surveyRecommendations = buildSurveyRecommendations(form.basics.siteAddress);
  const autoSurveyPoints = buildAutoSurveyPoints(form.basics.siteAddress, topisCandidates, gyeonggiCandidates, surveyRecommendations);
  const selectedSurveyPoint = selectSurveyPoint(autoSurveyPoints);
  const roadNameSignature = form.roads.map((row) => safe(row.name)).filter(Boolean).join("|");
  const landuseSlices = buildPieSlices(landuseStats.entries, landuseStats.total);
  const zoningSlices = buildPieSlices(zoningStats.entries, zoningStats.total);

  useEffect(() => {
    let cancelled = false;

    async function loadTopisCandidates() {
      if (detectSurveyRegion(form.basics.siteAddress) !== "seoul") {
        setTopisCandidates([]);
        setTopisStatus("");
        return;
      }

      if (safe(form.basics.siteAddress).length < 8) {
        setTopisCandidates([]);
        setTopisStatus("서울 사업지 주소를 조금 더 구체적으로 입력하면 최근접 TOPIS 지점을 계산합니다.");
        return;
      }

      if (!kakaoJsKey) {
        setTopisCandidates([]);
        setTopisStatus("서울 TOPIS 최근접 추천은 카카오 지도 키 설정 후 사용할 수 있습니다.");
        return;
      }

      try {
        setTopisStatus("서울 TOPIS 지점 좌표를 확인하는 중입니다.");
        await loadKakaoSdk(kakaoJsKey, mapRuntimeRef);

        const sourceLat = Number(form.basics.centerLat);
        const sourceLng = Number(form.basics.centerLng);
        let origin = null;

        if (Number.isFinite(sourceLat) && Number.isFinite(sourceLng)) {
          origin = { y: String(sourceLat), x: String(sourceLng) };
        } else {
          origin = await geocodeAddress(form.basics.siteAddress);
        }

        const geocoder = new window.kakao.maps.services.Geocoder();
        const stored = JSON.parse(window.localStorage.getItem(TOPIS_POINT_CACHE_KEY) || "{}");
        const enriched = [];
        let updated = false;
        let missingCount = 0;

        for (const point of seoulTopisPoints) {
          const cached = stored[point.code];
          if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
            enriched.push({ ...point, lat: cached.lat, lng: cached.lng });
            continue;
          }

          missingCount += 1;
          const result = await tryAddressSearch(geocoder, point.address, window.kakao.maps.services.AnalyzeType.SIMILAR)
            .catch(() => tryKeywordSearch(point.address))
            .catch(() => null);

          if (!result) continue;

          const lat = Number(result.y);
          const lng = Number(result.x);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

          stored[point.code] = { lat, lng };
          enriched.push({ ...point, lat, lng });
          updated = true;
        }

        if (updated) {
          window.localStorage.setItem(TOPIS_POINT_CACHE_KEY, JSON.stringify(stored));
        }

        const originLat = Number(origin.y);
        const originLng = Number(origin.x);
        const candidates = enriched
          .map((point) => ({
            ...point,
            distanceKm: distanceBetweenKm(originLat, originLng, point.lat, point.lng),
          }))
          .filter((point) => Number.isFinite(point.distanceKm))
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, 3);

        if (cancelled) return;

        setTopisCandidates(candidates);
        setTopisStatus(
          candidates.length
            ? `서울 TOPIS 최근접 후보 ${candidates.length}개를 계산했습니다.${missingCount ? " 일부 지점은 주소 변환 결과에 따라 보정이 필요할 수 있습니다." : ""}`
            : "서울 TOPIS 최근접 후보를 계산하지 못했습니다.",
        );
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setTopisCandidates([]);
        setTopisStatus("서울 TOPIS 최근접 후보를 불러오지 못했습니다.");
      }
    }

    loadTopisCandidates();

    return () => {
      cancelled = true;
    };
  }, [form.basics.siteAddress, form.basics.centerLat, form.basics.centerLng, kakaoJsKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadGyeonggiCandidates() {
      if (detectSurveyRegion(form.basics.siteAddress) !== "gyeonggi") {
        setGyeonggiCandidates([]);
        setGyeonggiStatus("");
        return;
      }

      if (safe(form.basics.siteAddress).length < 8) {
        setGyeonggiCandidates([]);
        setGyeonggiStatus("경기도 사업지 주소를 조금 더 구체적으로 입력하면 가까운 GITS 지점번호 후보를 계산합니다.");
        return;
      }

      if (!roadNameSignature) {
        setGyeonggiCandidates([]);
        setGyeonggiStatus("가로망 조사 결과가 있어야 경기도 GITS 지점번호 후보를 추천할 수 있습니다.");
        return;
      }

      if (!kakaoJsKey) {
        setGyeonggiCandidates([]);
        setGyeonggiStatus("경기도 GITS 후보 계산에는 카카오 지도 설정이 필요합니다.");
        return;
      }

      try {
        setGyeonggiStatus("경기도 GITS 수시교통량 지점번호 후보를 계산하는 중입니다.");

        const response = await fetch("/api/gyeonggi-survey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: form.basics.siteAddress,
            roadNames: form.roads.map((row) => safe(row.name)).filter(Boolean),
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to load Gyeonggi survey candidates");
        }

        const payload = await response.json();

        if (!payload.points?.length) {
          if (cancelled) return;
          setGyeonggiCandidates([]);
          setGyeonggiStatus("자동 조사된 도로와 일치하는 경기도 GITS 지점번호 후보를 찾지 못했습니다. 아래 공식 추천 출처를 함께 확인해 주세요.");
          return;
        }

        await loadKakaoSdk(kakaoJsKey, mapRuntimeRef);

        const sourceLat = Number(form.basics.centerLat);
        const sourceLng = Number(form.basics.centerLng);
        let origin = null;

        if (Number.isFinite(sourceLat) && Number.isFinite(sourceLng)) {
          origin = { y: String(sourceLat), x: String(sourceLng) };
        } else {
          origin = await geocodeAddress(form.basics.siteAddress);
        }

        const stored = JSON.parse(window.localStorage.getItem(GYEONGGI_POINT_CACHE_KEY) || "{}");
        const enriched = [];
        let updated = false;

        for (const point of payload.points) {
          const cached = stored[point.pointCode];
          if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
            enriched.push({ ...point, lat: cached.lat, lng: cached.lng, locationResolved: true });
            continue;
          }

          const location = await resolveGyeonggiPointLocation(point, form.basics.siteAddress).catch(() => null);
          if (!location) {
            enriched.push({ ...point, locationResolved: false });
            continue;
          }

          stored[point.pointCode] = location;
          enriched.push({ ...point, lat: location.lat, lng: location.lng, locationResolved: true });
          updated = true;
        }

        if (updated) {
          window.localStorage.setItem(GYEONGGI_POINT_CACHE_KEY, JSON.stringify(stored));
        }

        const originLat = Number(origin.y);
        const originLng = Number(origin.x);
        const candidates = enriched
          .map((point, index) => {
            const hasLocation = Number.isFinite(point.lat) && Number.isFinite(point.lng);
            return {
              ...point,
              recommendationMode: payload.mode || "none",
              distanceKm: hasLocation ? distanceBetweenKm(originLat, originLng, point.lat, point.lng) : null,
              sortIndex: index,
            };
          })
          .sort((a, b) => {
            const resolvedDiff = Number(Boolean(b.locationResolved)) - Number(Boolean(a.locationResolved));
            if (resolvedDiff !== 0) return resolvedDiff;

            const aDistance = Number.isFinite(a.distanceKm) ? a.distanceKm : Number.MAX_SAFE_INTEGER;
            const bDistance = Number.isFinite(b.distanceKm) ? b.distanceKm : Number.MAX_SAFE_INTEGER;
            const distanceDiff = aDistance - bDistance;
            if (distanceDiff !== 0) return distanceDiff;

            const tokenDiff = toSortableNumber(b.tokenScore) - toSortableNumber(a.tokenScore);
            if (tokenDiff !== 0) return tokenDiff;

            return a.sortIndex - b.sortIndex;
          })
          .slice(0, 3);

        if (cancelled) return;

        setGyeonggiCandidates(candidates);
        setGyeonggiStatus(
          candidates.length
            ? `경기도 GITS ${payload.year || ""} 수시교통량 기준 지점번호 후보 ${candidates.length}개를 준비했습니다. 거리 계산이 가능한 지점은 근사거리도 함께 표시합니다.`
            : "경기도 GITS 지점번호 후보를 찾지 못했습니다. 아래 공식 추천 출처를 함께 확인해 주세요.",
        );
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setGyeonggiCandidates([]);
        setGyeonggiStatus("경기도 GITS 지점번호 후보를 불러오지 못했습니다.");
      }
    }

    loadGyeonggiCandidates();

    return () => {
      cancelled = true;
    };
  }, [form.basics.siteAddress, form.basics.centerLat, form.basics.centerLng, kakaoJsKey, roadNameSignature]);

  useEffect(() => {
    syncSurveyCandidateOverlays({
      mapRuntimeRef,
      address: form.basics.siteAddress,
      topisCandidates,
      gyeonggiCandidates,
      centerLat: form.basics.centerLat,
      centerLng: form.basics.centerLng,
      rectWidth: form.basics.rectWidth,
      rectHeight: form.basics.rectHeight,
    });
  }, [
    topisCandidates,
    gyeonggiCandidates,
    form.basics.siteAddress,
    form.basics.centerLat,
    form.basics.centerLng,
    form.basics.rectWidth,
    form.basics.rectHeight,
  ]);

  function updateBasics(field, value) {
    setForm((current) => ({
      ...current,
      basics: {
        ...current.basics,
        [field]: value,
        ...(field === "siteAddress" || field === "rectWidth" || field === "rectHeight" ? { centerLat: "", centerLng: "" } : {}),
      },
    }));

    if (field === "siteAddress" || field === "rectWidth" || field === "rectHeight") {
      setMapStatus('입력값이 바뀌었습니다. "조사 시작" 버튼을 눌러 다시 반영해 주세요.');
    }
  }

  function updateListItem(listName, index, patch) {
    setForm((current) => ({
      ...current,
      [listName]: current[listName].map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  }

  function addRow(listName, factory) {
    setForm((current) => ({
      ...current,
      [listName]: [...current[listName], factory()],
    }));
  }

  function removeRow(listName, index, factory) {
    setForm((current) => {
      const next = current[listName].filter((_, itemIndex) => itemIndex !== index);
      return { ...current, [listName]: next.length ? next : [factory()] };
    });
  }

  function updateLanduseArea(category, value) {
    setForm((current) => ({
      ...current,
      landuseAreas: { ...current.landuseAreas, [category]: value },
    }));
  }

  function addSurveyRecommendation(recommendation) {
    const jurisdiction = deriveJurisdictionName(form.basics.siteAddress, "");
    addRow("surveyPoints", () => createSurveyRow({
      jurisdiction,
      dataType: recommendation.dataType,
      note: recommendation.description,
      source: recommendation.source,
      sourceLink: recommendation.sourceLink,
      downloadLink: recommendation.downloadLink,
    }));
    setStatusText(`${recommendation.title} 추천 정보를 사전조사지점 표에 추가했습니다.`);
  }

  function addTopisCandidate(candidate) {
    addRow("surveyPoints", () => createSurveyRow({
      pointCode: candidate.code,
      pointName: candidate.name,
      jurisdiction: "서울특별시",
      distanceKm: candidate.distanceKm.toFixed(1),
      dataType: "time",
      note: `서울 TOPIS 최근접 후보 / ${candidate.address}`,
      source: "서울시 TOPIS",
      sourceLink: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily",
      downloadLink: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolReport",
    }));
    setStatusText(`${candidate.code} ${candidate.name} 지점을 사전조사지점 표에 추가했습니다.`);
  }

  function addGyeonggiCandidate(candidate) {
    addRow("surveyPoints", () => createSurveyRow({
      pointCode: candidate.pointCode,
      pointName: `${candidate.routeName} / ${candidate.sectionName}`,
      jurisdiction: candidate.jurisdiction,
      distanceKm: Number.isFinite(candidate.distanceKm) ? candidate.distanceKm.toFixed(1) : "",
      dataType: "time",
      note: `경기 GITS 근사 추천 / ${candidate.sectionName}`,
      source: "경기도교통정보시스템",
      sourceLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do",
      downloadLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do",
    }));
    setStatusText(`${candidate.pointCode} 지점번호 후보를 사전조사지점 표에 추가했습니다.`);
  }

  async function renderScopeMap() {
    const address = safe(form.basics.siteAddress);
    const width = toNumber(form.basics.rectWidth);
    const height = toNumber(form.basics.rectHeight);

    if (!kakaoJsKey) {
      setMapStatus("앱 설정에 카카오 지도 JavaScript 키가 없습니다. 배포 환경변수 KAKAO_JS_KEY를 설정해 주세요.");
      setStatusText("지도 범위를 표시하지 못했습니다.");
      return;
    }

    if (!address) {
      setMapStatus("중심점으로 사용할 주소를 입력해 주세요.");
      setStatusText("지도 범위를 표시하지 못했습니다.");
      return;
    }

    if (width <= 0 || height <= 0) {
      setMapStatus("가로와 세로 범위를 모두 1m 이상으로 입력해 주세요.");
      setStatusText("지도 범위를 표시하지 못했습니다.");
      return;
    }

    try {
      setMapStatus("카카오 지도 SDK를 불러오는 중입니다.");
      setStatusText("조사 범위를 지도에 표시하고 가로망을 자동 조사하는 중입니다.");

      await loadKakaoSdk(kakaoJsKey, mapRuntimeRef);
      const result = await geocodeAddress(address);
      const lat = Number(result.y);
      const lng = Number(result.x);
      const kakao = window.kakao;
      const boundsData = computeRectangleBounds(lat, lng, width, height);
      const center = new kakao.maps.LatLng(lat, lng);
      const sw = new kakao.maps.LatLng(boundsData.south, boundsData.west);
      const ne = new kakao.maps.LatLng(boundsData.north, boundsData.east);
      const bounds = new kakao.maps.LatLngBounds(sw, ne);

      if (!mapRuntimeRef.current.map) {
        mapRuntimeRef.current.map = new kakao.maps.Map(mapContainerRef.current, {
          center,
          level: 5,
        });
      }

      clearMapOverlays(mapRuntimeRef);

      mapRuntimeRef.current.marker = new kakao.maps.Marker({ position: center, map: mapRuntimeRef.current.map });
      mapRuntimeRef.current.rectangle = new kakao.maps.Rectangle({
        bounds,
        strokeWeight: 2,
        strokeColor: "#0b4f8a",
        strokeOpacity: 0.9,
        strokeStyle: "solid",
        fillColor: "#0b4f8a",
        fillOpacity: 0.12,
      });
      mapRuntimeRef.current.rectangle.setMap(mapRuntimeRef.current.map);

      mapRuntimeRef.current.infoWindow = new kakao.maps.InfoWindow({
        content: `<div style="padding:10px 12px;font-size:13px;line-height:1.5;"><strong>${escapeHtml(address)}</strong><br>가로 ${formatNumber(width)}m / 세로 ${formatNumber(height)}m</div>`,
      });
      mapRuntimeRef.current.infoWindow.open(mapRuntimeRef.current.map, mapRuntimeRef.current.marker);
      mapRuntimeRef.current.map.setBounds(bounds, 48, 48, 48, 48);
      syncSurveyCandidateOverlays({
        mapRuntimeRef,
        address,
        topisCandidates,
        gyeonggiCandidates,
        centerLat: lat,
        centerLng: lng,
        rectWidth: width,
        rectHeight: height,
      });

      setMapStatus("조사 영역에 걸친 도로를 자동 조사하는 중입니다.");
      const autoRoadRows = await collectRoadRowsInScope({
        lat,
        lng,
        width,
        height,
      });

      setForm((current) => ({
        ...current,
        basics: {
          ...current.basics,
          centerLat: lat.toFixed(6),
          centerLng: lng.toFixed(6),
        },
        roads: autoRoadRows.length ? autoRoadRows : [createRoadRow({ roadClass: "로" })],
      }));
      setMapStatus(`"${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m 범위를 지도에 표시했고, 범위에 걸친 도로 ${autoRoadRows.length}건을 자동 조사했습니다.`);
      setStatusText(autoRoadRows.length ? "지도 범위와 가로망 자동조사를 갱신했습니다." : "지도 범위는 표시했지만 범위에 걸친 도로를 찾지 못했습니다.");
    } catch (error) {
      console.error(error);
      setMapStatus(error.message || "지도 표시 중 오류가 발생했습니다.");
      setStatusText("지도 범위를 표시하지 못했습니다.");
    }
  }

  function applySampleState(nextForm, label) {
    setForm(nextForm);
    clearMapOverlays(mapRuntimeRef);
    setMapStatus(`${label} 샘플 데이터를 채웠습니다. 필요하면 바로 조사 범위를 표시할 수 있습니다.`);
    setStatusText(`${label} 샘플 데이터를 반영했습니다.`);
  }

  function fillSeoulSampleData() {
    applySampleState({
      basics: {
        siteAddress: "서울특별시 중구 세종대로 110",
        rectWidth: "1200",
        rectHeight: "900",
        centerLat: "",
        centerLng: "",
      },
      roads: [
        createRoadRow({ roadClass: "대로", name: "세종대로", startAddress: "", endAddress: "", source: "서울특별시 도로명주소" }),
        createRoadRow({ roadClass: "대로", name: "을지로", startAddress: "", endAddress: "", source: "서울특별시 도로명주소" }),
        createRoadRow({ roadClass: "로", name: "덕수궁길", startAddress: "", endAddress: "", source: "서울특별시 도로명주소" }),
      ],
      surveyPoints: [createSurveyRow()],
      landuseSource: "서울특별시 통계연보 예시",
      zoningSource: "서울특별시 도시계획 자료 예시",
      landuseAreas: { 전: "0", 답: "0", 임야: "0", 대지: "540000", 도로: "210000", 하천: "12000", 학교: "6000", 공원: "38000", 기타: "94000" },
      zoningRows: [
        createZoningRow({ name: "주거지역", area: "120000" }),
        createZoningRow({ name: "상업지역", area: "410000" }),
        createZoningRow({ name: "공업지역", area: "0" }),
        createZoningRow({ name: "녹지지역", area: "46000" }),
        createZoningRow({ name: "관리지역", area: "0" }),
        createZoningRow({ name: "기타", area: "108000" }),
      ],
      trafficPlans: [
        createTrafficPlanRow({ title: "도심부 보행 및 대중교통 우선체계 검토", relatedPlan: "서울특별시 도시기본계획 예시", description: "세종대로 일대 차량 흐름과 보행 동선을 함께 검토하는 예시 계획입니다.", source: "서울시 계획자료 예시" }),
      ],
      constructionPlans: [
        createConstructionPlanRow({ title: "도심권 교차로 운영개선 사업 예시", location: "세종대로 일원", status: "계획 검토", source: "서울시 보도자료 예시" }),
      ],
    }, "서울");
  }

  function fillGyeonggiSampleData() {
    applySampleState({
      basics: {
        siteAddress: "경기도 수원시 팔달구 효원로 241",
        rectWidth: "1200",
        rectHeight: "800",
        centerLat: "",
        centerLng: "",
      },
      roads: [
        createRoadRow({ roadClass: "고속도로", name: "영동고속도로", startAddress: "", endAddress: "", source: "국가교통정보센터" }),
        createRoadRow({ roadClass: "대로", name: "경수대로", startAddress: "", endAddress: "", source: "수원시 도로현황도" }),
        createRoadRow({ roadClass: "로", name: "효원로", startAddress: "", endAddress: "", source: "수원시 도로현황도" }),
      ],
      surveyPoints: [
        createSurveyRow({
          pointName: "수원시청사거리",
          jurisdiction: "수원시",
          distanceKm: "0.7",
          dataType: "time",
          note: "첨두시 확인 가능",
          source: "경기도교통정보시스템 수시교통량",
          sourceLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do",
          downloadLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do",
        }),
        createSurveyRow({
          pointName: "인계사거리",
          jurisdiction: "수원시",
          distanceKm: "1.4",
          dataType: "average",
          note: "요일별 평균교통량만 확인",
          source: "경기데이터드림 요일별 상시평균 교통량",
          sourceLink: "https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=Y8Y8YVLJQYM4K5GJ56GV32744671&infSeq=2",
          downloadLink: "https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=Y8Y8YVLJQYM4K5GJ56GV32744671&infSeq=2",
        }),
      ],
      landuseSource: "수원시 통계연보 2025",
      zoningSource: "수원시 도시계획 자료 2025",
      landuseAreas: { 전: "220000", 답: "135000", 임야: "180000", 대지: "460000", 도로: "290000", 하천: "64000", 학교: "38000", 공원: "52000", 기타: "91000" },
      zoningRows: [
        createZoningRow({ name: "주거지역", area: "510000" }),
        createZoningRow({ name: "상업지역", area: "120000" }),
        createZoningRow({ name: "공업지역", area: "90000" }),
        createZoningRow({ name: "녹지지역", area: "310000" }),
        createZoningRow({ name: "관리지역", area: "70000" }),
        createZoningRow({ name: "기타", area: "110000" }),
      ],
      trafficPlans: [
        createTrafficPlanRow({ title: "시내부 간선도로 체계 정비", relatedPlan: "2030 수원시 도시기본계획", description: "주요 간선축 교차로 운영 개선 및 연결성 강화", source: "수원시 도시계획 보고서" }),
      ],
      constructionPlans: [
        createConstructionPlanRow({ title: "경수대로 확장공사", location: "수원시청 일원", status: "공사중", source: "도로과 보도자료" }),
      ],
    }, "경기도");
  }

  function resetAll() {
    if (!window.confirm("입력된 내용을 모두 초기화할까요?")) return;

    setForm(createBlankState());
    clearMapOverlays(mapRuntimeRef);
    if (mapRuntimeRef.current.map && mapContainerRef.current) {
      mapContainerRef.current.innerHTML = "";
      mapRuntimeRef.current.map = null;
    }
    setMapStatus('배포 환경에 카카오 지도 키를 설정한 뒤 "조사 시작" 버튼을 눌러 주세요.');
    setStatusText("모든 입력값을 초기화했습니다.");
  }

  return (
    <main className={`app-shell${embedded ? " embedded-shell" : ""}`}>
      <section className="hero-card">
        <div className="hero-main">
          <p className="eyebrow">TIA Research Builder</p>
          <h1>교통영향평가 조사 초안 작성 도구</h1>
          <div className="hero-form">
            <label className="full">
              <span>주소지</span>
              <input value={form.basics.siteAddress} onChange={(event) => updateBasics("siteAddress", event.target.value)} placeholder="예: 경기도 수원시 팔달구 효원로 241" />
            </label>
            <div className="inline-fields full">
              <label>
                <span>가로 범위(m)</span>
                <input type="number" min="1" step="1" value={form.basics.rectWidth} onChange={(event) => updateBasics("rectWidth", event.target.value)} placeholder="예: 1200" />
              </label>
              <label>
                <span>세로 범위(m)</span>
                <input type="number" min="1" step="1" value={form.basics.rectHeight} onChange={(event) => updateBasics("rectHeight", event.target.value)} placeholder="예: 800" />
              </label>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={renderScopeMap}>조사 시작</button>
          <div className="hero-action-stack">
            <button type="button" className="secondary" onClick={fillSeoulSampleData}>서울 샘플</button>
            <button type="button" className="secondary" onClick={fillGyeonggiSampleData}>경기도 샘플</button>
          </div>
          <button type="button" className="ghost" onClick={resetAll}>전체 초기화</button>
        </div>
      </section>

      <section className="panel project-panel">
        <div className="panel-header compact-panel-header">
          <div>
            <p className="eyebrow">지도 범위</p>
            <h2>카카오 지도</h2>
          </div>
        </div>

        <div className="map-card project-map-card">
          <div className="map-header">
            <h3>카카오 지도</h3>
            <p className="chart-caption">{mapStatus}</p>
          </div>
          <div ref={mapContainerRef} className="map-view" aria-label="조사 범위 지도" />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>가로망 조사</h2>
          </div>
          <button type="button" className="secondary" onClick={() => addRow("roads", () => createRoadRow({ roadClass: "로" }))}>도로 추가</button>
        </div>

        <div className="tag-strip">
          {ROAD_CLASSES.map((roadClass) => <span key={roadClass} className="tag">{roadClass}</span>)}
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>도로 구분</th>
                <th>도로명</th>
                <th>기점 주소</th>
                <th>종점 주소</th>
                <th>출처</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {form.roads.map((row, index) => (
                <tr key={`road-${index}`}>
                  <td>
                    <select className="table-select" value={row.roadClass} onChange={(event) => updateListItem("roads", index, { roadClass: event.target.value })}>
                      {ROAD_CLASSES.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </td>
                  <td><input className="table-input" value={row.name} onChange={(event) => updateListItem("roads", index, { name: event.target.value })} placeholder="예: 경수대로" /></td>
                  <td><input className="table-input" value={row.startAddress} onChange={(event) => updateListItem("roads", index, { startAddress: event.target.value })} placeholder={MANUAL_RESEARCH_PLACEHOLDER} /></td>
                  <td><input className="table-input" value={row.endAddress} onChange={(event) => updateListItem("roads", index, { endAddress: event.target.value })} placeholder={MANUAL_RESEARCH_PLACEHOLDER} /></td>
                  <td><input className="table-input" value={row.source} onChange={(event) => updateListItem("roads", index, { source: event.target.value })} placeholder="예: 도로 현황도" /></td>
                  <td className="actions"><button type="button" className="mini-button" onClick={() => removeRow("roads", index, () => createRoadRow({ roadClass: "로" }))}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>가까운 사전조사지점</h2>
          </div>
        </div>

        {detectSurveyRegion(form.basics.siteAddress) === "seoul" ? (
          <div className="survey-recommendation-block">
            <div className="output-header">
              <h3>서울 TOPIS 최근접 3지점</h3>
            </div>
            <p className="priority-note">{topisStatus || "서울 TOPIS 지점 좌표를 준비하는 중입니다."}</p>
            <div className="survey-recommendations">
              {topisCandidates.map((candidate) => (
                <article key={candidate.code} className="survey-recommendation-card">
                  <div className="survey-recommendation-top">
                    <span className="status-badge">{candidate.code}</span>
                    <p className="eyebrow">{candidate.category}</p>
                  </div>
                  <h3>{candidate.name}</h3>
                  <p>{candidate.address}</p>
                  <p className="candidate-distance">사업지 기준 {formatDistance(candidate.distanceKm)}</p>
                  <div className="survey-links">
                    <a href="https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily" target="_blank" rel="noreferrer">출처 보기</a>
                    <a href="https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolReport" target="_blank" rel="noreferrer">조사자료 PDF</a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {detectSurveyRegion(form.basics.siteAddress) === "gyeonggi" ? (
          <div className="survey-recommendation-block">
            <div className="output-header">
              <h3>경기 GITS 최근접 3지점</h3>
            </div>
            <p className="priority-note">{gyeonggiStatus || "경기 GITS 지점번호 후보를 준비하고 있습니다."}</p>
            <div className="survey-recommendations">
              {gyeonggiCandidates.map((candidate) => (
                <article key={`${candidate.routeCode}-${candidate.pointCode}`} className="survey-recommendation-card">
                  <div className="survey-recommendation-top">
                    <span className="status-badge">{candidate.pointCode}</span>
                    <p className="eyebrow">{candidate.categoryLabel}</p>
                  </div>
                  <h3>{candidate.routeName}</h3>
                  <p>{candidate.jurisdiction} / {candidate.sectionName}</p>
                  <p className="candidate-distance">
                    {Number.isFinite(candidate.distanceKm)
                      ? `사업지 기준 ${formatDistance(candidate.distanceKm)}`
                      : "거리 계산 전 단계 후보"}
                  </p>
                  <p className="candidate-note">
                    {Number.isFinite(candidate.distanceKm)
                      ? "거리 계산은 구간 양끝(IC/JCT) 기준의 근사값입니다."
                      : "지점번호는 공식 GITS 자료 기준이며, 현재는 거리 계산 없이 후보로 먼저 표시합니다."}
                  </p>
                  <div className="survey-links">
                    <a href="https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do" target="_blank" rel="noreferrer">출처 보기</a>
                    <a href="https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/regularAverageTrafficVolumeByWeekday.do" target="_blank" rel="noreferrer">2순위 자료</a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        <div className="survey-recommendations">
          {surveyRecommendations.map((recommendation) => (
            <article key={recommendation.key} className="survey-recommendation-card">
              <div className="survey-recommendation-top">
                <span className="status-badge">{recommendation.priorityLabel}</span>
                <p className="eyebrow">공식 추천 출처</p>
              </div>
              <h3>{recommendation.title}</h3>
              <p>{recommendation.description}</p>
              <div className="survey-links">
                <a href={recommendation.sourceLink} target="_blank" rel="noreferrer">출처 보기</a>
                <a href={recommendation.downloadLink} target="_blank" rel="noreferrer">다운로드/조회</a>
              </div>
            </article>
          ))}
        </div>

        <div className="priority-card">
          <div>
            <p className="priority-label">최종 판정</p>
            <p className="priority-result">{buildPriorityResult(selectedSurveyPoint, autoSurveyPoints)}</p>
          </div>
          <p className="priority-note">{buildPriorityNote(selectedSurveyPoint, autoSurveyPoints)}</p>
        </div>

      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2>토지이용 현황 및 계획</h2>
          </div>
        </div>

        <div className="form-grid compact-grid">
          <label>
            <span>토지이용 출처</span>
            <input value={form.landuseSource} onChange={(event) => setForm((current) => ({ ...current, landuseSource: event.target.value }))} placeholder="예: 수원시 통계연보 2025" />
          </label>
          <label>
            <span>용도지역 출처</span>
            <input value={form.zoningSource} onChange={(event) => setForm((current) => ({ ...current, zoningSource: event.target.value }))} placeholder="예: 수원시 도시계획 자료 2025" />
          </label>
        </div>

        <div className="subpanel-grid">
          <section className="subpanel">
            <div className="subpanel-header"><h3>지목별 토지이용현황</h3></div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>지목</th>
                    <th>면적(㎡)</th>
                    <th>구성비(%)</th>
                  </tr>
                </thead>
                <tbody>
                  {LANDUSE_CATEGORIES.map((category) => (
                    <tr key={category} className={rankClass(landuseStats.rankMap.get(category))}>
                      <td>{category}</td>
                      <td><input className="table-input" type="number" value={form.landuseAreas[category]} onChange={(event) => updateLanduseArea(category, event.target.value)} placeholder="면적 입력" /></td>
                      <td>{formatPercent(landuseStats.ratioMap.get(category))}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td>계</td>
                    <td>{formatNumber(landuseStats.total)}</td>
                    <td>{landuseStats.total > 0 ? "100.0%" : "-"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="subpanel">
            <div className="subpanel-header">
              <h3>용도지역 현황</h3>
              <button type="button" className="secondary" onClick={() => addRow("zoningRows", createZoningRow)}>용도지역 추가</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>용도지역</th>
                    <th>면적(㎡)</th>
                    <th>구성비(%)</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {form.zoningRows.map((row, index) => (
                    <tr key={`zoning-${index}`} className={rankClass(zoningStats.rankMap.get(index))}>
                      <td><input className="table-input" value={row.name} onChange={(event) => updateListItem("zoningRows", index, { name: event.target.value })} placeholder="예: 주거지역" /></td>
                      <td><input className="table-input" type="number" value={row.area} onChange={(event) => updateListItem("zoningRows", index, { area: event.target.value })} placeholder="면적 입력" /></td>
                      <td>{formatPercent(zoningStats.ratioMap.get(index))}</td>
                      <td className="actions"><button type="button" className="mini-button" onClick={() => removeRow("zoningRows", index, createZoningRow)}>삭제</button></td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td>계</td>
                    <td>{formatNumber(zoningStats.total)}</td>
                    <td>{zoningStats.total > 0 ? "100.0%" : "-"}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="chart-grid">
          <section className="chart-card">
            <div className="chart-header">
              <h3>지목별 토지이용 원형 그래프</h3>
              <p className="chart-caption">{landuseStats.total > 0 ? `총면적 ${formatNumber(landuseStats.total)}㎡` : "총면적 미입력"}</p>
            </div>
            <div className="chart-layout">
              <div className="pie-chart" style={{ background: pieBackground(landuseSlices) }} />
              <div className="legend">
                {landuseSlices.length ? landuseSlices.map((slice) => (
                  <div key={slice.label} className="legend-item">
                    <span className="legend-swatch" style={{ background: slice.color }} />
                    <span>{slice.label}</span>
                    <strong>{formatPercent(slice.percent)} / {formatNumber(slice.value)}㎡</strong>
                  </div>
                )) : <p className="chart-caption">입력된 지목별 면적이 없습니다.</p>}
              </div>
            </div>
          </section>

          <section className="chart-card">
            <div className="chart-header">
              <h3>용도지역 원형 그래프</h3>
              <p className="chart-caption">{zoningStats.total > 0 ? `총면적 ${formatNumber(zoningStats.total)}㎡` : "총면적 미입력"}</p>
            </div>
            <div className="chart-layout">
              <div className="pie-chart" style={{ background: pieBackground(zoningSlices) }} />
              <div className="legend">
                {zoningSlices.length ? zoningSlices.map((slice) => (
                  <div key={`${slice.label}-${slice.key}`} className="legend-item">
                    <span className="legend-swatch" style={{ background: slice.color }} />
                    <span>{slice.label}</span>
                    <strong>{formatPercent(slice.percent)} / {formatNumber(slice.value)}㎡</strong>
                  </div>
                )) : <p className="chart-caption">입력된 용도지역 면적이 없습니다.</p>}
              </div>
            </div>
          </section>
        </div>

      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 4</p>
            <h2>교통관련 계획</h2>
          </div>
        </div>

        <div className="subpanel-grid">
          <section className="subpanel">
            <div className="subpanel-header">
              <h3>교통계획</h3>
              <button type="button" className="secondary" onClick={() => addRow("trafficPlans", createTrafficPlanRow)}>계획 추가</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>계획명</th>
                    <th>연계 도시계획</th>
                    <th>내용</th>
                    <th>출처</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {form.trafficPlans.map((row, index) => (
                    <tr key={`traffic-${index}`}>
                      <td><input className="table-input" value={row.title} onChange={(event) => updateListItem("trafficPlans", index, { title: event.target.value })} placeholder="예: 시내부 간선도로망 계획" /></td>
                      <td><input className="table-input" value={row.relatedPlan} onChange={(event) => updateListItem("trafficPlans", index, { relatedPlan: event.target.value })} placeholder="예: 2030 도시기본계획" /></td>
                      <td><textarea className="table-textarea" value={row.description} onChange={(event) => updateListItem("trafficPlans", index, { description: event.target.value })} placeholder="예: 교차로 개량 및 도로 확장 계획" /></td>
                      <td><input className="table-input" value={row.source} onChange={(event) => updateListItem("trafficPlans", index, { source: event.target.value })} placeholder="예: 시청 교통정책과" /></td>
                      <td className="actions"><button type="button" className="mini-button" onClick={() => removeRow("trafficPlans", index, createTrafficPlanRow)}>삭제</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="subpanel">
            <div className="subpanel-header">
              <h3>공사 중인 시설계획</h3>
              <button type="button" className="secondary" onClick={() => addRow("constructionPlans", createConstructionPlanRow)}>시설계획 추가</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>시설명</th>
                    <th>위치/구간</th>
                    <th>진행상태</th>
                    <th>출처</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {form.constructionPlans.map((row, index) => (
                    <tr key={`construction-${index}`}>
                      <td><input className="table-input" value={row.title} onChange={(event) => updateListItem("constructionPlans", index, { title: event.target.value })} placeholder="예: 경수대로 확장공사" /></td>
                      <td><input className="table-input" value={row.location} onChange={(event) => updateListItem("constructionPlans", index, { location: event.target.value })} placeholder="예: 수원시청~인계사거리" /></td>
                      <td><input className="table-input" value={row.status} onChange={(event) => updateListItem("constructionPlans", index, { status: event.target.value })} placeholder="예: 공사중" /></td>
                      <td><input className="table-input" value={row.source} onChange={(event) => updateListItem("constructionPlans", index, { source: event.target.value })} placeholder="예: 도로과 보도자료" /></td>
                      <td className="actions"><button type="button" className="mini-button" onClick={() => removeRow("constructionPlans", index, createConstructionPlanRow)}>삭제</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

      </section>

      <section className="panel status-panel">
        <div>
          <p className="eyebrow">Status</p>
          <h2>작업 상태</h2>
        </div>
        <p className="status-text">{statusText}</p>
      </section>
    </main>
  );
}

function buildScopeData(basics) {
  const address = safe(basics.siteAddress);
  const width = toNumber(basics.rectWidth);
  const height = toNumber(basics.rectHeight);
  const cityName = deriveCityName(address, "대상 도시");
  const jurisdictionName = deriveJurisdictionName(address, cityName);
  const meta = [];

  if (!address && !width && !height) {
    return { summary: "주소지와 가로·세로 범위를 입력하면 조사 범위 요약이 여기에 표시됩니다.", meta };
  }
  if (!address) {
    return { summary: "주소지를 입력해 중심점을 정해 주세요.", meta };
  }
  if (width <= 0 || height <= 0) {
    return { summary: "가로 범위와 세로 범위를 모두 1m 이상으로 입력해 주세요.", meta };
  }

  meta.push(`중심 주소: ${address}`);
  meta.push(`관할 추정: ${jurisdictionName}`);
  meta.push(`가로: ${formatNumber(width)}m`);
  meta.push(`세로: ${formatNumber(height)}m`);
  meta.push(`면적: ${formatNumber(width * height)}㎡`);
  if (basics.centerLat && basics.centerLng) {
    meta.push(`중심 좌표: ${basics.centerLat}, ${basics.centerLng}`);
  }

  return {
    summary: `${jurisdictionName} 내 조사 범위는 "${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m의 직사각형으로 설정됩니다.${basics.centerLat && basics.centerLng ? ` 중심 좌표는 (${basics.centerLat}, ${basics.centerLng})입니다.` : ""}`,
    meta,
  };
}

function buildRoadSummary(form) {
  const lines = [];
  const address = safe(form.basics.siteAddress);
  const width = toNumber(form.basics.rectWidth);
  const height = toNumber(form.basics.rectHeight);
  const cityName = deriveCityName(address, "대상지");
  const jurisdictionName = deriveJurisdictionName(address, cityName);
  const filledRoads = form.roads.filter((row) => isFilled(row.name) || isFilled(row.startAddress) || isFilled(row.endAddress));

  if (address && width > 0 && height > 0) {
    lines.push(`${jurisdictionName} 일대 가로망 조사는 "${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m 범위 안에서 수행한다.`);
  } else {
    lines.push("기본 정보에서 주소지와 가로·세로 범위를 입력해 조사 범위를 먼저 설정한다.");
  }
  lines.push("조사 대상 도로 구분은 고속도로, 대로, 로를 기본 기준으로 한다.");
  lines.push("범위 내에 걸친 도로명은 자동으로 수집하되, 도로 전체 기준의 기점·종점 주소는 별도 수동 조사가 필요하다.");
  if (form.basics.centerLat && form.basics.centerLng) {
    lines.push(`중심 좌표는 위도 ${form.basics.centerLat}, 경도 ${form.basics.centerLng}이다.`);
  }

  if (!filledRoads.length) {
    lines.push("범위 검토 후 도로명, 기점 주소, 종점 주소를 입력한다.");
  } else {
    filledRoads.forEach((row, index) => {
      const source = safe(row.source) ? ` / 출처: ${row.source}` : "";
      lines.push(`${index + 1}. [${row.roadClass}] ${safe(row.name) || "도로명 미입력"} / 기점: ${safe(row.startAddress) || "기점 주소 미입력"} / 종점: ${safe(row.endAddress) || "종점 주소 미입력"}${source}`);
    });
  }

  return lines.join("\n");
}

function buildPriorityResult(selectedSurveyPoint, surveyPoints) {
  const hasRows = surveyPoints.some(isSurveyRowFilled);
  if (!hasRows) return "후보 없음";
  if (!selectedSurveyPoint || selectedSurveyPoint.dataType === "none") return "후보 없음";
  if (selectedSurveyPoint.dataType === "time") return "1순위 후보";
  if (selectedSurveyPoint.dataType === "average") return "2순위 후보";
  return "후보 없음";
}

function buildPriorityNote(selectedSurveyPoint, surveyPoints) {
  const hasRows = surveyPoints.some(isSurveyRowFilled);
  if (!hasRows) return "추천 가능한 조사지점을 아직 찾지 못했습니다.";
  if (!selectedSurveyPoint || selectedSurveyPoint.dataType === "none") {
    return "1순위와 2순위 자료를 아직 확인하지 못했습니다.";
  }
  const pointLabel = `${safe(selectedSurveyPoint.pointCode) ? `${safe(selectedSurveyPoint.pointCode)} / ` : ""}${safe(selectedSurveyPoint.pointName) || safe(selectedSurveyPoint.source) || "지점명 미입력"}`;
  return selectedSurveyPoint.dataType === "time"
    ? `${pointLabel} / 요일별 시간대별 교통량 확인`
    : `${pointLabel} / 요일별 평균 교통량 확인`;
}

function buildSurveySummary(form, selectedSurveyPoint) {
  const filledRows = form.surveyPoints.filter(isSurveyRowFilled);
  if (!filledRows.length) return "조사지점 후보를 입력해 주세요.";

  const lines = [];
  const jurisdictionName = deriveJurisdictionName(form.basics.siteAddress, "해당 관할");
  if (selectedSurveyPoint && selectedSurveyPoint.dataType !== "none") {
    lines.push(`${jurisdictionName} 기준으로 가장 우선 검토할 사전조사지점은 ${(safe(selectedSurveyPoint.pointCode) ? `${safe(selectedSurveyPoint.pointCode)} ` : "") + (safe(selectedSurveyPoint.pointName) || safe(selectedSurveyPoint.source) || "지점명 미입력")}이며, 자료 유형은 ${surveyTypeLabel(selectedSurveyPoint.dataType)}이다.`);
  } else {
    lines.push("현재 입력 기준으로는 1순위와 2순위 조건을 만족하는 사전조사지점을 찾지 못했다.");
  }

  filledRows.slice().sort(compareSurveyRows).forEach((row, index) => {
    const source = safe(row.source) ? ` / 출처: ${row.source}` : "";
    const note = safe(row.note) ? ` / 비고: ${row.note}` : "";
    const sourceLink = safe(row.sourceLink) ? ` / 출처 링크: ${row.sourceLink}` : "";
    const downloadLink = safe(row.downloadLink) ? ` / 다운로드·조회 링크: ${row.downloadLink}` : "";
    const pointLabel = `${safe(row.pointCode) ? `${safe(row.pointCode)} / ` : ""}${safe(row.pointName) || "지점명 미입력"}`;
    lines.push(`${index + 1}. ${pointLabel} / 관할: ${safe(row.jurisdiction) || "-"} / 거리: ${formatDistance(row.distanceKm)} / 자료 유형: ${surveyTypeLabel(row.dataType)}${note}${source}${sourceLink}${downloadLink}`);
  });

  return lines.join("\n");
}

function buildLanduseSummary(form, landuseStats, zoningStats) {
  const cityName = deriveCityName(form.basics.siteAddress, "대상 도시");
  return [
    `${cityName}의 지목별 토지이용현황과 용도지역 현황을 면적과 구성비 기준으로 정리했다.`,
    landuseStats.total > 0
      ? `지목별 토지이용 총면적은 ${formatNumber(landuseStats.total)}㎡이며, 상위 항목은 ${topLabels(landuseStats.entries, landuseStats.total) || "집계 중"}이다.`
      : "지목별 토지이용 면적이 아직 입력되지 않았다.",
    zoningStats.total > 0
      ? `용도지역 총면적은 ${formatNumber(zoningStats.total)}㎡이며, 상위 항목은 ${topLabels(zoningStats.entries, zoningStats.total) || "집계 중"}이다.`
      : "용도지역 면적이 아직 입력되지 않았다.",
    `토지이용 출처: ${safe(form.landuseSource) || "미입력"}`,
    `용도지역 출처: ${safe(form.zoningSource) || "미입력"}`,
  ].join("\n");
}

function buildPlanSummary(form) {
  const trafficPlans = form.trafficPlans.filter((row) => isFilled(row.title) || isFilled(row.relatedPlan) || isFilled(row.description));
  const constructionPlans = form.constructionPlans.filter((row) => isFilled(row.title) || isFilled(row.location) || isFilled(row.status));
  const cityName = deriveCityName(form.basics.siteAddress, "대상 도시");
  const jurisdictionName = deriveJurisdictionName(form.basics.siteAddress, cityName);
  const lines = [`${jurisdictionName}와 연관된 교통계획 및 공사 중인 시설계획을 정리한다.`];

  if (!trafficPlans.length) {
    lines.push("연계 교통계획 입력값이 아직 없다.");
  } else {
    lines.push("교통계획");
    trafficPlans.forEach((row, index) => {
      const source = safe(row.source) ? ` / 출처: ${row.source}` : "";
      lines.push(`${index + 1}. ${safe(row.title) || "계획명 미입력"} / 연계 계획: ${safe(row.relatedPlan) || "-"} / 내용: ${safe(row.description) || "-"}${source}`);
    });
  }

  if (!constructionPlans.length) {
    lines.push("공사 중인 시설계획 입력값이 아직 없다.");
  } else {
    lines.push("공사 중인 시설계획");
    constructionPlans.forEach((row, index) => {
      const source = safe(row.source) ? ` / 출처: ${row.source}` : "";
      lines.push(`${index + 1}. ${safe(row.title) || "시설명 미입력"} / 위치: ${safe(row.location) || "-"} / 상태: ${safe(row.status) || "-"}${source}`);
    });
  }

  return lines.join("\n");
}

function rankClass(rank) {
  return rank ? `rank-${rank}` : "";
}

function normalizeAddress(address) {
  return safe(address).replace(/\s+/g, " ");
}

function deriveCityName(address, fallback) {
  const normalized = normalizeAddress(address);
  if (!normalized) return fallback;

  const parts = normalized.split(" ").filter(Boolean);
  const cityLike = parts.find((part) => /[시군구]$/.test(part));

  return cityLike || parts[0] || fallback;
}

function deriveJurisdictionName(address, fallback) {
  const normalized = normalizeAddress(address);
  if (!normalized) return fallback;

  const parts = normalized.split(" ").filter(Boolean);
  const adminParts = [];

  for (const part of parts) {
    if (/(특별자치도|특별자치시|특별시|광역시|자치시|자치도|도|시|군|구)$/.test(part)) {
      adminParts.push(part);
      if (adminParts.length >= 3) break;
      continue;
    }
    if (adminParts.length) break;
  }

  return adminParts.length ? adminParts.join(" ") : deriveCityName(address, fallback);
}

function detectSurveyRegion(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return "unknown";

  const compact = normalized.replace(/\s+/g, " ").trim();
  const hasRegionToken = (tokens) =>
    tokens.some((token) => compact.startsWith(`${token} `) || compact.includes(` ${token} `) || compact === token);

  if (hasRegionToken(["서울특별시", "서울시", "서울"])) return "seoul";
  if (hasRegionToken(["경기도", "경기"])) return "gyeonggi";
  return "other";
}

function buildSurveyRecommendations(address) {
  const region = detectSurveyRegion(address);

  if (region === "seoul") {
    return [
      {
        key: "seoul-time",
        priorityLabel: "1순위",
        dataType: "time",
        title: "서울시 TOPIS 도로별 일자별 교통량",
        description: "요일별 시간대별 교통량 확인용으로 우선 검토합니다.",
        source: "서울시 TOPIS",
        sourceLink: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily",
        downloadLink: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolDaily",
      },
      {
        key: "seoul-average",
        priorityLabel: "2순위",
        dataType: "average",
        title: "서울시 TOPIS 교통량 보고서",
        description: "1순위 자료를 찾지 못한 경우 평균 교통량 보고서 확인용으로 사용합니다.",
        source: "서울시 TOPIS",
        sourceLink: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolReport",
        downloadLink: "https://topis.seoul.go.kr/refRoom/openRefRoom_2.do?tab=trafficvolReport",
      },
    ];
  }

  if (region === "gyeonggi") {
    return [
      {
        key: "gyeonggi-time",
        priorityLabel: "1순위",
        dataType: "time",
        title: "경기도교통정보시스템 수시교통량",
        description: "지점별, 시간대별, 방향별 교통량을 우선 검토합니다.",
        source: "경기도교통정보시스템",
        sourceLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do",
        downloadLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do",
      },
      {
        key: "gyeonggi-average",
        priorityLabel: "2순위",
        dataType: "average",
        title: "경기데이터드림 요일별 상시평균 교통량",
        description: "1순위 자료가 없을 때 요일별 평균 교통량 자료를 검토합니다.",
        source: "경기데이터드림",
        sourceLink: "https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=Y8Y8YVLJQYM4K5GJ56GV32744671&infSeq=2",
        downloadLink: "https://data.gg.go.kr/portal/data/service/selectServicePage.do?infId=Y8Y8YVLJQYM4K5GJ56GV32744671&infSeq=2",
      },
      {
        key: "gyeonggi-fallback",
        priorityLabel: "보조",
        dataType: "average",
        title: "교통량정보제공시스템 상시조사 교통량",
        description: "경기도 자료가 부족할 때 전국 단위 공식 시스템에서 보조 확인합니다.",
        source: "교통량정보제공시스템",
        sourceLink: "https://www.road.re.kr/",
        downloadLink: "https://www.road.re.kr/pds/request_list.asp",
      },
    ];
  }

  return [
    {
      key: "national-time",
      priorityLabel: "1순위",
      dataType: "time",
      title: "교통량정보제공시스템 상시조사 자료",
      description: "전국 단위 공식 시스템에서 시간대별 조사자료 가능 여부를 먼저 확인합니다.",
      source: "교통량정보제공시스템",
      sourceLink: "https://www.road.re.kr/",
      downloadLink: "https://www.road.re.kr/pds/request_list.asp",
    },
    {
      key: "national-average",
      priorityLabel: "2순위",
      dataType: "average",
      title: "교통량정보제공시스템 요청자료실",
      description: "1순위 자료가 부족하면 통계연보 및 요청자료실을 검토합니다.",
      source: "교통량정보제공시스템",
      sourceLink: "https://www.road.re.kr/pds/request_list.asp",
      downloadLink: "https://www.road.re.kr/pds/request_list.asp",
    },
  ];
}

function classifyRoadClass(roadName) {
  if (!roadName) return null;
  if (roadName.endsWith("고속도로")) return "고속도로";
  if (roadName.endsWith("대로")) return "대로";
  if (roadName.endsWith("로")) return "로";
  return null;
}

function buildScopeSamplePoints(lat, lng, widthMeters, heightMeters) {
  const bounds = computeRectangleBounds(lat, lng, widthMeters, heightMeters);
  const xCount = Math.min(Math.max(Math.ceil(widthMeters / 180) + 1, 4), 7);
  const yCount = Math.min(Math.max(Math.ceil(heightMeters / 180) + 1, 4), 7);
  const points = [];
  const seen = new Set();

  for (let yIndex = 0; yIndex < yCount; yIndex += 1) {
    const yRatio = yCount === 1 ? 0.5 : yIndex / (yCount - 1);
    const sampleLat = bounds.south + ((bounds.north - bounds.south) * yRatio);

    for (let xIndex = 0; xIndex < xCount; xIndex += 1) {
      const xRatio = xCount === 1 ? 0.5 : xIndex / (xCount - 1);
      const sampleLng = bounds.west + ((bounds.east - bounds.west) * xRatio);
      const key = `${sampleLat.toFixed(6)}:${sampleLng.toFixed(6)}`;

      if (!seen.has(key)) {
        seen.add(key);
        points.push({ lat: sampleLat, lng: sampleLng });
      }
    }
  }

  return points;
}

function coordToAddress(geocoder, lng, lat) {
  return new Promise((resolve, reject) => {
    geocoder.coord2Address(lng, lat, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result?.length) {
        resolve(result[0]);
        return;
      }
      reject(new Error("coord2Address failed"));
    });
  });
}

function buildRoadRowsFromBuckets(roadBuckets) {
  return Array.from(roadBuckets.values())
    .map((bucket) => {
      const sortedSamples = bucket.samples
        .slice()
        .sort((a, b) => (a.lat - b.lat) || (a.lng - b.lng) || a.address.localeCompare(b.address, "ko"));

      return createRoadRow({
        roadClass: bucket.roadClass,
        name: bucket.name,
        startAddress: "",
        endAddress: "",
        source: "카카오 좌표-주소 변환 자동조사",
      });
    })
    .sort((a, b) => {
      const roadClassDiff = ROAD_CLASSES.indexOf(a.roadClass) - ROAD_CLASSES.indexOf(b.roadClass);
      if (roadClassDiff !== 0) return roadClassDiff;
      return a.name.localeCompare(b.name, "ko");
    });
}

async function collectRoadRowsInScope({ lat, lng, width, height }) {
  const geocoder = new window.kakao.maps.services.Geocoder();
  const points = buildScopeSamplePoints(lat, lng, width, height);
  const roadBuckets = new Map();

  for (let index = 0; index < points.length; index += 6) {
    const chunk = points.slice(index, index + 6);
    const results = await Promise.all(
      chunk.map((point) => coordToAddress(geocoder, point.lng, point.lat).catch(() => null)),
    );

    results.forEach((result, chunkIndex) => {
      const roadAddress = result?.road_address;
      const roadName = safe(roadAddress?.road_name);
      const roadClass = classifyRoadClass(roadName);

      if (!roadAddress || !roadName || !roadClass) return;

      const point = chunk[chunkIndex];
      const sampleAddress = safe(roadAddress.address_name) || `${roadName}`;
      const key = `${roadClass}:${roadName}`;

      if (!roadBuckets.has(key)) {
        roadBuckets.set(key, {
          roadClass,
          name: roadName,
          samples: [],
        });
      }

      const bucket = roadBuckets.get(key);
      if (!bucket.samples.some((sample) => sample.address === sampleAddress)) {
        bucket.samples.push({
          address: sampleAddress,
          lat: point.lat,
          lng: point.lng,
        });
      }
    });
  }

  return buildRoadRowsFromBuckets(roadBuckets);
}

function computeRectangleBounds(lat, lng, widthMeters, heightMeters) {
  const latDelta = (heightMeters / 2) / 111320;
  const lngBase = 111320 * Math.cos((lat * Math.PI) / 180);
  const lngDelta = (widthMeters / 2) / Math.max(lngBase, 1);
  return {
    north: lat + latDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    west: lng - lngDelta,
  };
}

function escapeHtml(text) {
  return safe(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildSurveyMapCandidates(address, topisCandidates, gyeonggiCandidates) {
  const region = detectSurveyRegion(address);

  if (region === "seoul") {
    return topisCandidates
      .filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng))
      .slice(0, 3)
      .map((candidate, index) => ({
        key: candidate.code || `seoul-${index}`,
        code: candidate.code || `서울-${index + 1}`,
        title: candidate.name || "서울 TOPIS 지점",
        subtitle: candidate.address || "",
        lat: candidate.lat,
        lng: candidate.lng,
      }));
  }

  if (region === "gyeonggi") {
    return gyeonggiCandidates
      .filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng))
      .slice(0, 3)
      .map((candidate, index) => ({
        key: candidate.pointCode || `gyeonggi-${index}`,
        code: candidate.pointCode || `경기-${index + 1}`,
        title: candidate.sectionName || candidate.routeName || "경기도 GITS 지점",
        subtitle: candidate.routeName ? `${candidate.routeName}${candidate.sectionName ? ` / ${candidate.sectionName}` : ""}` : "",
        lat: candidate.lat,
        lng: candidate.lng,
      }));
  }

  return [];
}

function clearSurveyCandidateOverlays(mapRuntimeRef) {
  for (const marker of mapRuntimeRef.current.surveyMarkers || []) {
    marker.setMap(null);
  }
  for (const overlay of mapRuntimeRef.current.surveyOverlays || []) {
    overlay.setMap(null);
  }
  mapRuntimeRef.current.surveyMarkers = [];
  mapRuntimeRef.current.surveyOverlays = [];
}

function syncSurveyCandidateOverlays({
  mapRuntimeRef,
  address,
  topisCandidates,
  gyeonggiCandidates,
  centerLat,
  centerLng,
  rectWidth,
  rectHeight,
}) {
  if (!mapRuntimeRef.current.map || !window.kakao?.maps) return;

  clearSurveyCandidateOverlays(mapRuntimeRef);

  const lat = Number(centerLat);
  const lng = Number(centerLng);
  const width = toNumber(rectWidth);
  const height = toNumber(rectHeight);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || width <= 0 || height <= 0) return;

  const candidates = buildSurveyMapCandidates(address, topisCandidates, gyeonggiCandidates);
  if (!candidates.length) return;

  const kakao = window.kakao;
  const boundsData = computeRectangleBounds(lat, lng, width, height);
  const displayBounds = new kakao.maps.LatLngBounds(
    new kakao.maps.LatLng(boundsData.south, boundsData.west),
    new kakao.maps.LatLng(boundsData.north, boundsData.east),
  );

  candidates.forEach((candidate) => {
    const position = new kakao.maps.LatLng(candidate.lat, candidate.lng);
    displayBounds.extend(position);

    const marker = new kakao.maps.Marker({
      position,
      map: mapRuntimeRef.current.map,
      title: `${candidate.code} ${candidate.title}`.trim(),
    });

    const overlay = new kakao.maps.CustomOverlay({
      position,
      yAnchor: 1.8,
      content: `
        <div class="survey-point-overlay" title="${escapeHtml(`${candidate.code} ${candidate.title}`.trim())}">
          <span class="survey-point-code">${escapeHtml(candidate.code)}</span>
        </div>
      `,
    });

    overlay.setMap(mapRuntimeRef.current.map);
    mapRuntimeRef.current.surveyMarkers.push(marker);
    mapRuntimeRef.current.surveyOverlays.push(overlay);
  });

  mapRuntimeRef.current.map.setBounds(displayBounds, 48, 48, 48, 48);
}

function clearMapOverlays(mapRuntimeRef) {
  if (mapRuntimeRef.current.marker) {
    mapRuntimeRef.current.marker.setMap(null);
    mapRuntimeRef.current.marker = null;
  }
  if (mapRuntimeRef.current.rectangle) {
    mapRuntimeRef.current.rectangle.setMap(null);
    mapRuntimeRef.current.rectangle = null;
  }
  if (mapRuntimeRef.current.infoWindow) {
    mapRuntimeRef.current.infoWindow.close();
    mapRuntimeRef.current.infoWindow = null;
  }
  clearSurveyCandidateOverlays(mapRuntimeRef);
}

function loadKakaoSdk(key, mapRuntimeRef) {
  if (window.kakao?.maps?.services) {
    if (mapRuntimeRef.current.loadedKey && mapRuntimeRef.current.loadedKey !== key) {
      return Promise.reject(new Error("카카오 지도 키가 변경되었습니다. 새 키를 반영하려면 앱을 다시 배포하거나 새로고침해 주세요."));
    }
    mapRuntimeRef.current.loadedKey = key;
    return Promise.resolve(window.kakao);
  }

  if (mapRuntimeRef.current.sdkPromise) {
    return mapRuntimeRef.current.sdkPromise;
  }

  mapRuntimeRef.current.loadedKey = key;
  mapRuntimeRef.current.sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey=${encodeURIComponent(key)}`;
    script.onload = () => {
      if (!window.kakao?.maps?.load) {
        reject(new Error("카카오 지도 SDK 로딩에 실패했습니다."));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao));
    };
    script.onerror = () => reject(new Error("카카오 지도 스크립트를 불러오지 못했습니다."));
    document.head.appendChild(script);
  }).catch((error) => {
    mapRuntimeRef.current.sdkPromise = null;
    throw error;
  });

  return mapRuntimeRef.current.sdkPromise;
}

function tryAddressSearch(geocoder, address, analyzeType) {
  return new Promise((resolve, reject) => {
    geocoder.addressSearch(address, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result?.length) {
        resolve(result[0]);
        return;
      }
      reject(new Error("address search failed"));
    }, { analyze_type: analyzeType });
  });
}

function tryKeywordSearch(keyword) {
  const places = new window.kakao.maps.services.Places();
  return new Promise((resolve, reject) => {
    places.keywordSearch(keyword, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result?.length) {
        resolve(result[0]);
        return;
      }
      reject(new Error("keyword search failed"));
    }, { size: 1 });
  });
}

function buildAddressContextTokens(address) {
  const genericTokens = new Set(["대한민국", "한국", "경기도", "경기", "서울특별시", "서울시", "서울"]);

  return Array.from(
    new Set(
      safe(address)
        .split(/\s+/)
        .flatMap((part) => {
          const cleaned = part.replace(/[^\p{L}\p{N}]/gu, "");
          if (cleaned.length < 2 || /^\d+$/.test(cleaned) || genericTokens.has(cleaned)) {
            return [];
          }

          const expanded = [cleaned];
          if (/[시군구읍면동로길]$/.test(cleaned) && cleaned.length >= 3) {
            expanded.push(cleaned.slice(0, -1));
          }
          return expanded;
        })
        .filter((token) => token.length >= 2 && !genericTokens.has(token)),
    ),
  );
}

function buildGyeonggiPointQueries(point, projectAddress = "") {
  const queries = [];
  const contextTokens = buildAddressContextTokens(projectAddress).slice(0, 3);
  const sectionAnchors = safe(point.sectionName)
    .split(/\s*-\s*/)
    .map((part) => safe(part))
    .filter(Boolean);

  sectionAnchors.forEach((anchor) => {
    if (safe(point.jurisdiction) && point.jurisdiction !== "-") {
      queries.push(`${point.jurisdiction} ${anchor}`);
    }
    contextTokens.forEach((token) => {
      queries.push(`${token} ${anchor}`);
      queries.push(`${token} ${point.routeName} ${anchor}`);
    });
    queries.push(`${point.routeName} ${anchor}`);
    queries.push(anchor);
  });

  if (safe(point.jurisdiction) && point.jurisdiction !== "-") {
    queries.push(`${point.jurisdiction} ${point.sectionName}`);
  }
  contextTokens.forEach((token) => {
    queries.push(`${token} ${point.sectionName}`);
    queries.push(`${token} ${point.routeName}`);
    queries.push(`${token} ${point.routeName} ${point.sectionName}`);
  });
  queries.push(`${point.routeName} ${point.sectionName}`);
  queries.push(`${point.routeName} ${point.pointCode}`);

  return Array.from(new Set(queries.map((query) => safe(query)).filter(Boolean)));
}

async function resolveGyeonggiPointLocation(point, projectAddress = "") {
  const anchorQueries = buildGyeonggiPointQueries(point, projectAddress);
  const endpoints = safe(point.sectionName)
    .split(/\s*-\s*/)
    .map((part) => safe(part))
    .filter(Boolean);
  const anchorResults = [];

  for (const endpoint of endpoints.slice(0, 2)) {
    const endpointQueries = anchorQueries.filter((query) => query.includes(endpoint));
    let found = null;

    for (const query of endpointQueries) {
      found = await tryKeywordSearch(query).catch(() => null);
      if (found) break;
    }

    if (found) {
      anchorResults.push({ lat: Number(found.y), lng: Number(found.x) });
    }
  }

  if (anchorResults.length === 2) {
    return {
      lat: (anchorResults[0].lat + anchorResults[1].lat) / 2,
      lng: (anchorResults[0].lng + anchorResults[1].lng) / 2,
    };
  }

  if (anchorResults.length === 1) {
    return anchorResults[0];
  }

  for (const query of anchorQueries) {
    const found = await tryKeywordSearch(query).catch(() => null);
    if (found) {
      return { lat: Number(found.y), lng: Number(found.x) };
    }
  }

  throw new Error("Failed to geocode Gyeonggi survey point");
}

function geocodeAddress(address) {
  const normalized = normalizeAddress(address);
  const geocoder = new window.kakao.maps.services.Geocoder();

  return tryAddressSearch(geocoder, normalized, window.kakao.maps.services.AnalyzeType.EXACT)
    .catch(() => tryAddressSearch(geocoder, normalized, window.kakao.maps.services.AnalyzeType.SIMILAR))
    .catch(() => tryKeywordSearch(normalized))
    .catch(() => {
      throw new Error("입력한 주소를 지도에서 찾지 못했습니다. 도로명주소나 지번주소를 더 구체적으로 입력해 주세요.");
    });
}
