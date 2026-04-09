"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "tia-research-builder-next-v1";
const LANDUSE_CATEGORIES = ["전", "답", "임야", "대지", "도로", "하천", "학교", "공원", "기타"];
const ZONING_DEFAULTS = ["주거지역", "상업지역", "공업지역", "녹지지역", "관리지역", "기타"];
const ROAD_CLASSES = ["고속도로", "대로", "로"];
const SURVEY_TYPES = [
  { value: "time", label: "요일별 시간대별 교통량" },
  { value: "average", label: "요일별 평균 교통량" },
  { value: "none", label: "자료 없음" },
];
const CHART_COLORS = ["#0b4f8a", "#2f6fa5", "#5e90bb", "#8fb4d0", "#b7cbdd", "#d5dfeb", "#7f9c7a", "#c68f58", "#8a6b5c", "#b9a79d"];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function createBlankBasics() {
  return {
    cityName: "",
    jurisdictionName: "",
    siteAddress: "",
    rectWidth: "",
    rectHeight: "",
    baseDate: todayString(),
    projectNote: "",
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
  return { pointName: "", jurisdiction: "", distanceKm: "", dataType: "time", note: "", source: "", ...overrides };
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

function selectSurveyPoint(rows) {
  return rows
    .filter((row) => isFilled(row.pointName) || isFilled(row.jurisdiction) || isFilled(row.distanceKm))
    .slice()
    .sort(compareSurveyRows)[0] || null;
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
  const [mapStatus, setMapStatus] = useState('배포 환경에 카카오 지도 키를 설정한 뒤 "지도 범위 표시" 버튼을 눌러 주세요.');
  const hydratedRef = useRef(false);
  const mapContainerRef = useRef(null);
  const mapRuntimeRef = useRef({
    sdkPromise: null,
    loadedKey: "",
    map: null,
    marker: null,
    rectangle: null,
    infoWindow: null,
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
  const selectedSurveyPoint = selectSurveyPoint(form.surveyPoints);
  const scope = buildScopeData(form.basics);
  const landuseSlices = buildPieSlices(landuseStats.entries, landuseStats.total);
  const zoningSlices = buildPieSlices(zoningStats.entries, zoningStats.total);
  const roadSummary = buildRoadSummary(form);
  const surveySummary = buildSurveySummary(form, selectedSurveyPoint);
  const landuseSummary = buildLanduseSummary(form, landuseStats, zoningStats);
  const planSummary = buildPlanSummary(form);

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
      setMapStatus('입력값이 바뀌었습니다. "지도 범위 표시" 버튼을 눌러 다시 반영해 주세요.');
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

  async function copyText(text) {
    if (!text) {
      setStatusText("복사할 내용이 없습니다.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setStatusText("요약문을 복사했습니다.");
    } catch (error) {
      console.error(error);
      setStatusText("복사에 실패했습니다.");
    }
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
      setStatusText("조사 범위를 지도에 표시하는 중입니다.");

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

      setForm((current) => ({
        ...current,
        basics: {
          ...current.basics,
          centerLat: lat.toFixed(6),
          centerLng: lng.toFixed(6),
        },
      }));
      setMapStatus(`"${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m 범위를 지도에 표시했습니다.`);
      setStatusText("지도 범위를 갱신했습니다.");
    } catch (error) {
      console.error(error);
      setMapStatus(error.message || "지도 표시 중 오류가 발생했습니다.");
      setStatusText("지도 범위를 표시하지 못했습니다.");
    }
  }

  function fillSampleData() {
    setForm({
      basics: {
        cityName: "수원시",
        jurisdictionName: "경기도 수원시청",
        siteAddress: "경기도 수원시 팔달구 효원로 241",
        rectWidth: "1200",
        rectHeight: "800",
        baseDate: todayString(),
        projectNote: "통계연보 및 도시계획 자료 기준",
        centerLat: "",
        centerLng: "",
      },
      roads: [
        createRoadRow({ roadClass: "고속도로", name: "영동고속도로", startAddress: "수원신갈IC", endAddress: "동수원IC", source: "국가교통정보센터" }),
        createRoadRow({ roadClass: "대로", name: "경수대로", startAddress: "인계사거리", endAddress: "매교사거리", source: "수원시 도로현황도" }),
        createRoadRow({ roadClass: "로", name: "효원로", startAddress: "수원시청", endAddress: "인계동 일원", source: "수원시 도로현황도" }),
      ],
      surveyPoints: [
        createSurveyRow({ pointName: "수원시청사거리", jurisdiction: "수원시", distanceKm: "0.7", dataType: "time", note: "첨두시 확인 가능", source: "수시 교통량 조사자료" }),
        createSurveyRow({ pointName: "인계사거리", jurisdiction: "수원시", distanceKm: "1.4", dataType: "average", note: "요일별 평균교통량만 확인", source: "교통량 통계자료" }),
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
    });
    clearMapOverlays(mapRuntimeRef);
    setMapStatus("샘플 데이터를 채웠습니다. 필요하면 바로 지도 범위를 표시할 수 있습니다.");
    setStatusText("샘플 데이터를 반영했습니다.");
  }

  function resetAll() {
    if (!window.confirm("입력된 내용을 모두 초기화할까요?")) return;

    setForm(createBlankState());
    clearMapOverlays(mapRuntimeRef);
    if (mapRuntimeRef.current.map && mapContainerRef.current) {
      mapContainerRef.current.innerHTML = "";
      mapRuntimeRef.current.map = null;
    }
    setMapStatus('배포 환경에 카카오 지도 키를 설정한 뒤 "지도 범위 표시" 버튼을 눌러 주세요.');
    setStatusText("모든 입력값을 초기화했습니다.");
  }

  return (
    <main className={`app-shell${embedded ? " embedded-shell" : ""}`}>
      <section className="hero-card">
        <div>
          <p className="eyebrow">TIA Research Builder</p>
          <h1>교통영향평가 조사 초안 작성 도구</h1>
          <p className="hero-copy">
            주소지를 중심으로 조사 범위를 설정하고, 가로망 조사, 사전조사지점 정리, 토지이용 및 용도지역 정리,
            교통관련 계획 정리까지 한 화면에서 이어서 작성할 수 있습니다.
          </p>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={renderScopeMap}>지도 범위 표시</button>
          <button type="button" className="secondary" onClick={fillSampleData}>샘플 채우기</button>
          <button type="button" className="ghost" onClick={resetAll}>전체 초기화</button>
        </div>
      </section>

      <section className="panel project-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Project Basics</p>
            <h2>기본 정보 및 조사 범위</h2>
          </div>
          <p className="panel-copy">
            주소지를 중심점으로 하고, 입력한 가로·세로 길이만큼 직사각형 조사 범위를 설정합니다.
            지도 키는 앱 환경변수로 관리합니다.
          </p>
        </div>

        <div className="form-grid">
          <label>
            <span>도시명</span>
            <input value={form.basics.cityName} onChange={(event) => updateBasics("cityName", event.target.value)} placeholder="예: 수원시" />
          </label>
          <label>
            <span>관할명</span>
            <input value={form.basics.jurisdictionName} onChange={(event) => updateBasics("jurisdictionName", event.target.value)} placeholder="예: 경기도 수원시청" />
          </label>
          <label className="full">
            <span>주소지</span>
            <input value={form.basics.siteAddress} onChange={(event) => updateBasics("siteAddress", event.target.value)} placeholder="예: 경기도 수원시 팔달구 효원로 241" />
          </label>
          <label>
            <span>가로 범위(m)</span>
            <input type="number" min="1" step="1" value={form.basics.rectWidth} onChange={(event) => updateBasics("rectWidth", event.target.value)} placeholder="예: 1200" />
          </label>
          <label>
            <span>세로 범위(m)</span>
            <input type="number" min="1" step="1" value={form.basics.rectHeight} onChange={(event) => updateBasics("rectHeight", event.target.value)} placeholder="예: 800" />
          </label>
          <label>
            <span>기준일</span>
            <input type="date" value={form.basics.baseDate} onChange={(event) => updateBasics("baseDate", event.target.value)} />
          </label>
          <label className="full">
            <span>작성 메모</span>
            <input value={form.basics.projectNote} onChange={(event) => updateBasics("projectNote", event.target.value)} placeholder="예: 통계연보 2025년 기준" />
          </label>
        </div>

        <p className="inline-note">카카오 지도 JavaScript 키는 사용자 입력이 아니라 배포 환경변수 `KAKAO_JS_KEY`에서 읽습니다.</p>

        <div className="scope-card">
          <div className="scope-copy">
            <p className="eyebrow">Survey Scope</p>
            <h3>직사각형 조사 영역</h3>
            <p className="scope-summary">{scope.summary}</p>
            <div className="scope-meta">
              {scope.meta.map((item) => (
                <span key={item} className="meta-chip">{item}</span>
              ))}
            </div>
          </div>

          <div className="map-card">
            <div className="map-header">
              <h3>카카오 지도</h3>
              <p className="chart-caption">{mapStatus}</p>
            </div>
            <div ref={mapContainerRef} className="map-view" aria-label="조사 범위 지도" />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>가로망 조사</h2>
          </div>
          <p className="panel-copy">조사 대상 도로는 고속도로, 대로, 로를 기본 구분으로 두고 직사각형 범위 안에서 정리합니다.</p>
        </div>

        <div className="tag-strip">
          {ROAD_CLASSES.map((roadClass) => <span key={roadClass} className="tag">{roadClass}</span>)}
        </div>

        <div className="toolbar">
          <button type="button" className="secondary" onClick={() => addRow("roads", () => createRoadRow({ roadClass: "로" }))}>도로 추가</button>
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
                  <td><input className="table-input" value={row.startAddress} onChange={(event) => updateListItem("roads", index, { startAddress: event.target.value })} placeholder="기점 주소" /></td>
                  <td><input className="table-input" value={row.endAddress} onChange={(event) => updateListItem("roads", index, { endAddress: event.target.value })} placeholder="종점 주소" /></td>
                  <td><input className="table-input" value={row.source} onChange={(event) => updateListItem("roads", index, { source: event.target.value })} placeholder="예: 도로 현황도" /></td>
                  <td className="actions"><button type="button" className="mini-button" onClick={() => removeRow("roads", index, () => createRoadRow({ roadClass: "로" }))}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="output-block">
          <div className="output-header">
            <h3>가로망 조사 요약</h3>
            <button type="button" onClick={() => copyText(roadSummary)}>복사</button>
          </div>
          <textarea readOnly rows={7} value={roadSummary} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>가까운 사전조사지점</h2>
          </div>
          <p className="panel-copy">1순위는 요일별 시간대별 교통량, 2순위는 요일별 평균 교통량이며 둘 다 없으면 미확보로 표시합니다.</p>
        </div>

        <div className="toolbar">
          <button type="button" className="secondary" onClick={() => addRow("surveyPoints", createSurveyRow)}>조사지점 추가</button>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>조사지점명</th>
                <th>관할</th>
                <th>거리(km)</th>
                <th>자료 유형</th>
                <th>설명</th>
                <th>출처</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {form.surveyPoints.map((row, index) => (
                <tr key={`survey-${index}`}>
                  <td><input className="table-input" value={row.pointName} onChange={(event) => updateListItem("surveyPoints", index, { pointName: event.target.value })} placeholder="예: 수원시청사거리" /></td>
                  <td><input className="table-input" value={row.jurisdiction} onChange={(event) => updateListItem("surveyPoints", index, { jurisdiction: event.target.value })} placeholder="예: 수원시" /></td>
                  <td><input className="table-input" type="number" value={row.distanceKm} onChange={(event) => updateListItem("surveyPoints", index, { distanceKm: event.target.value })} placeholder="예: 1.8" /></td>
                  <td>
                    <select className="table-select" value={row.dataType} onChange={(event) => updateListItem("surveyPoints", index, { dataType: event.target.value })}>
                      {SURVEY_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </td>
                  <td><textarea className="table-textarea" value={row.note} onChange={(event) => updateListItem("surveyPoints", index, { note: event.target.value })} placeholder="예: 첨두시간 07~09시 확인 가능" /></td>
                  <td><input className="table-input" value={row.source} onChange={(event) => updateListItem("surveyPoints", index, { source: event.target.value })} placeholder="예: 수시 교통량 조사자료" /></td>
                  <td className="actions"><button type="button" className="mini-button" onClick={() => removeRow("surveyPoints", index, createSurveyRow)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="priority-card">
          <div>
            <p className="priority-label">최종 판정</p>
            <p className="priority-result">{buildPriorityResult(selectedSurveyPoint, form.surveyPoints)}</p>
          </div>
          <p className="priority-note">{buildPriorityNote(selectedSurveyPoint, form.surveyPoints)}</p>
        </div>

        <div className="output-block">
          <div className="output-header">
            <h3>사전조사지점 요약</h3>
            <button type="button" onClick={() => copyText(surveySummary)}>복사</button>
          </div>
          <textarea readOnly rows={7} value={surveySummary} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2>토지이용 현황 및 계획</h2>
          </div>
          <p className="panel-copy">지목별 토지이용현황과 용도지역 현황의 면적과 구성비를 계산하고 원형 그래프로 정리합니다.</p>
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

        <div className="output-block">
          <div className="output-header">
            <h3>토지이용 및 용도지역 요약</h3>
            <button type="button" onClick={() => copyText(landuseSummary)}>복사</button>
          </div>
          <textarea readOnly rows={8} value={landuseSummary} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Step 4</p>
            <h2>교통관련 계획</h2>
          </div>
          <p className="panel-copy">도시계획과 연계된 교통계획과 공사 중인 시설계획을 구분해서 정리합니다.</p>
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

        <div className="output-block">
          <div className="output-header">
            <h3>교통관련 계획 요약</h3>
            <button type="button" onClick={() => copyText(planSummary)}>복사</button>
          </div>
          <textarea readOnly rows={8} value={planSummary} />
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
  const cityName = safe(basics.cityName) || "대상 도시";
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
  meta.push(`가로: ${formatNumber(width)}m`);
  meta.push(`세로: ${formatNumber(height)}m`);
  meta.push(`면적: ${formatNumber(width * height)}㎡`);
  if (basics.centerLat && basics.centerLng) {
    meta.push(`중심 좌표: ${basics.centerLat}, ${basics.centerLng}`);
  }

  return {
    summary: `${cityName}의 조사 범위는 "${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m의 직사각형으로 설정됩니다.${basics.centerLat && basics.centerLng ? ` 중심 좌표는 (${basics.centerLat}, ${basics.centerLng})입니다.` : ""}`,
    meta,
  };
}

function buildRoadSummary(form) {
  const lines = [];
  const address = safe(form.basics.siteAddress);
  const width = toNumber(form.basics.rectWidth);
  const height = toNumber(form.basics.rectHeight);
  const cityName = safe(form.basics.cityName) || "대상지";
  const filledRoads = form.roads.filter((row) => isFilled(row.name) || isFilled(row.startAddress) || isFilled(row.endAddress));

  if (address && width > 0 && height > 0) {
    lines.push(`${cityName} 가로망 조사는 "${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m 범위 안에서 수행한다.`);
  } else {
    lines.push("기본 정보에서 주소지와 가로·세로 범위를 입력해 조사 범위를 먼저 설정한다.");
  }
  lines.push("조사 대상 도로 구분은 고속도로, 대로, 로를 기본 기준으로 한다.");
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
  const hasRows = surveyPoints.some((row) => isFilled(row.pointName) || isFilled(row.jurisdiction) || isFilled(row.distanceKm));
  if (!hasRows) return "아직 조사지점이 없습니다.";
  if (!selectedSurveyPoint || selectedSurveyPoint.dataType === "none") return "적정 조사지점 미확보";
  return `${safe(selectedSurveyPoint.pointName) || "지점명 미입력"} 우선 검토`;
}

function buildPriorityNote(selectedSurveyPoint, surveyPoints) {
  const hasRows = surveyPoints.some((row) => isFilled(row.pointName) || isFilled(row.jurisdiction) || isFilled(row.distanceKm));
  if (!hasRows) return "가까운 수시 교통량 조사지점을 입력하면 우선순위를 자동으로 판단합니다.";
  if (!selectedSurveyPoint || selectedSurveyPoint.dataType === "none") {
    return "1순위와 2순위 자료 유형이 모두 확인되지 않아 현 단계에서는 적정 조사지점을 찾지 못했습니다.";
  }
  return selectedSurveyPoint.dataType === "time"
    ? "요일별 시간대별 교통량 자료가 확인되어 1순위로 선정했습니다."
    : "요일별 시간대별 교통량 자료는 없지만, 요일별 평균 교통량 자료가 있어 2순위로 선정했습니다.";
}

function buildSurveySummary(form, selectedSurveyPoint) {
  const filledRows = form.surveyPoints.filter((row) => isFilled(row.pointName) || isFilled(row.jurisdiction) || isFilled(row.distanceKm) || row.dataType !== "time" || isFilled(row.note) || isFilled(row.source));
  if (!filledRows.length) return "조사지점 후보를 입력해 주세요.";

  const lines = [];
  if (selectedSurveyPoint && selectedSurveyPoint.dataType !== "none") {
    lines.push(`가장 우선 검토할 사전조사지점은 ${safe(selectedSurveyPoint.pointName) || "지점명 미입력"}이며, 자료 유형은 ${surveyTypeLabel(selectedSurveyPoint.dataType)}이다.`);
  } else {
    lines.push("현재 입력 기준으로는 1순위와 2순위 조건을 만족하는 사전조사지점을 찾지 못했다.");
  }

  filledRows.slice().sort(compareSurveyRows).forEach((row, index) => {
    const source = safe(row.source) ? ` / 출처: ${row.source}` : "";
    const note = safe(row.note) ? ` / 비고: ${row.note}` : "";
    lines.push(`${index + 1}. ${safe(row.pointName) || "지점명 미입력"} / 관할: ${safe(row.jurisdiction) || "-"} / 거리: ${formatDistance(row.distanceKm)} / 자료 유형: ${surveyTypeLabel(row.dataType)}${note}${source}`);
  });

  return lines.join("\n");
}

function buildLanduseSummary(form, landuseStats, zoningStats) {
  const cityName = safe(form.basics.cityName) || "대상 도시";
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
  const cityName = safe(form.basics.cityName) || "대상 도시";
  const lines = [`${cityName}와 연관된 교통계획 및 공사 중인 시설계획을 정리한다.`];

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
