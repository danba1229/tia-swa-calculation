const STORAGE_KEY = "tia-research-builder-v2";

const LANDUSE_CATEGORIES = ["전", "답", "임야", "대지", "도로", "하천", "학교", "공원", "기타"];
const ZONING_DEFAULTS = ["주거지역", "상업지역", "공업지역", "녹지지역", "관리지역", "기타"];
const ROAD_CLASSES = ["고속도로", "대로", "로"];
const SURVEY_TYPES = [
  { value: "time", label: "요일별 시간대별 교통량" },
  { value: "average", label: "요일별 평균 교통량" },
  { value: "none", label: "자료 없음" },
];
const CHART_COLORS = ["#0b4f8a", "#2f6fa5", "#5e90bb", "#8fb4d0", "#b7cbdd", "#d5dfeb", "#7f9c7a", "#c68f58", "#8a6b5c", "#b9a79d"];

const state = createBlankState();
const mapState = {
  sdkPromise: null,
  loadedKey: "",
  map: null,
  marker: null,
  rectangle: null,
  infoWindow: null,
};

init();

function init() {
  loadState();
  ensureBaseDate();
  normalizeState();
  bindStaticInputs();
  bindButtons();
  seedMinimumRows();
  renderAll();
  updateMapStatus('카카오 지도 JavaScript 키와 주소지를 입력한 뒤 "지도 범위 표시" 버튼을 눌러 주세요.');
  updateStatus("초기 화면이 준비되었습니다.");
}

function createBlankState() {
  return {
    basics: createBlankBasics(),
    roads: [],
    surveyPoints: [],
    landuseSource: "",
    zoningSource: "",
    landuseAreas: createBlankLanduseAreas(),
    zoningRows: [],
    trafficPlans: [],
    constructionPlans: [],
  };
}

function createBlankBasics() {
  return {
    cityName: "",
    jurisdictionName: "",
    siteAddress: "",
    rectWidth: "",
    rectHeight: "",
    baseDate: "",
    kakaoJsKey: "",
    projectNote: "",
    centerLat: "",
    centerLng: "",
  };
}

function createBlankLanduseAreas() {
  return Object.fromEntries(LANDUSE_CATEGORIES.map((category) => [category, ""]));
}

function ensureBaseDate() {
  if (!state.basics.baseDate) {
    state.basics.baseDate = new Date().toISOString().slice(0, 10);
  }
}

function normalizeState() {
  state.basics = { ...createBlankBasics(), ...(state.basics || {}) };
  state.roads = Array.isArray(state.roads) ? state.roads : [];
  state.surveyPoints = Array.isArray(state.surveyPoints) ? state.surveyPoints : [];
  state.landuseAreas = { ...createBlankLanduseAreas(), ...(state.landuseAreas || {}) };
  state.zoningRows = Array.isArray(state.zoningRows) ? state.zoningRows : [];
  state.trafficPlans = Array.isArray(state.trafficPlans) ? state.trafficPlans : [];
  state.constructionPlans = Array.isArray(state.constructionPlans) ? state.constructionPlans : [];
  state.landuseSource = state.landuseSource || "";
  state.zoningSource = state.zoningSource || "";
}

function bindStaticInputs() {
  bindTextInput("city-name", (value) => {
    state.basics.cityName = value;
  });
  bindTextInput("jurisdiction-name", (value) => {
    state.basics.jurisdictionName = value;
  });
  bindTextInput("site-address", (value) => {
    state.basics.siteAddress = value;
    invalidateScopePreview();
  });
  bindTextInput("rect-width", (value) => {
    state.basics.rectWidth = value;
    invalidateScopePreview();
  });
  bindTextInput("rect-height", (value) => {
    state.basics.rectHeight = value;
    invalidateScopePreview();
  });
  bindTextInput("base-date", (value) => {
    state.basics.baseDate = value;
  });
  bindTextInput("kakao-js-key", (value) => {
    state.basics.kakaoJsKey = value;
    invalidateScopePreview();
  });
  bindTextInput("project-note", (value) => {
    state.basics.projectNote = value;
  });
  bindTextInput("landuse-source", (value) => {
    state.landuseSource = value;
  });
  bindTextInput("zoning-source", (value) => {
    state.zoningSource = value;
  });
}

function bindTextInput(id, onChange) {
  const element = document.getElementById(id);
  if (!element) return;

  element.addEventListener("input", (event) => {
    onChange(event.target.value.trim());
    refreshComputedOutputs();
    saveState();
  });
}

function bindButtons() {
  document.getElementById("add-road").addEventListener("click", () => {
    state.roads.push(createRoadRow({ roadClass: ROAD_CLASSES[state.roads.length % ROAD_CLASSES.length] }));
    renderRoadRows();
    refreshComputedOutputs();
    saveState();
  });

  document.getElementById("add-survey-point").addEventListener("click", () => {
    state.surveyPoints.push(createSurveyRow());
    renderSurveyRows();
    refreshComputedOutputs();
    saveState();
  });

  document.getElementById("add-zoning-row").addEventListener("click", () => {
    state.zoningRows.push(createZoningRow());
    renderZoningRows();
    refreshComputedOutputs();
    saveState();
  });

  document.getElementById("add-traffic-plan").addEventListener("click", () => {
    state.trafficPlans.push(createTrafficPlanRow());
    renderTrafficPlanRows();
    refreshComputedOutputs();
    saveState();
  });

  document.getElementById("add-construction-plan").addEventListener("click", () => {
    state.constructionPlans.push(createConstructionPlanRow());
    renderConstructionRows();
    refreshComputedOutputs();
    saveState();
  });

  document.getElementById("render-map").addEventListener("click", async () => {
    await renderScopeMap();
  });

  document.getElementById("fill-sample").addEventListener("click", fillSampleData);
  document.getElementById("clear-all").addEventListener("click", resetAll);

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.copyTarget);
      copyText(target.value, button);
    });
  });
}

function seedMinimumRows() {
  if (!state.roads.length) state.roads = ROAD_CLASSES.map((roadClass) => createRoadRow({ roadClass }));
  if (!state.surveyPoints.length) state.surveyPoints = [createSurveyRow()];
  if (!state.zoningRows.length) state.zoningRows = ZONING_DEFAULTS.map((name) => createZoningRow({ name }));
  if (!state.trafficPlans.length) state.trafficPlans = [createTrafficPlanRow()];
  if (!state.constructionPlans.length) state.constructionPlans = [createConstructionPlanRow()];
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

function renderAll() {
  hydrateBasics();
  renderRoadRows();
  renderSurveyRows();
  renderLanduseRows();
  renderZoningRows();
  renderTrafficPlanRows();
  renderConstructionRows();
  refreshComputedOutputs();
}

function hydrateBasics() {
  setValue("city-name", state.basics.cityName);
  setValue("jurisdiction-name", state.basics.jurisdictionName);
  setValue("site-address", state.basics.siteAddress);
  setValue("rect-width", state.basics.rectWidth);
  setValue("rect-height", state.basics.rectHeight);
  setValue("base-date", state.basics.baseDate);
  setValue("kakao-js-key", state.basics.kakaoJsKey);
  setValue("project-note", state.basics.projectNote);
  setValue("landuse-source", state.landuseSource);
  setValue("zoning-source", state.zoningSource);
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value || "";
}

function refreshComputedOutputs() {
  renderScopeSummary();
  updateLanduseTableDisplay();
  updateZoningTableDisplay();
  renderRoadSummary();
  renderSurveySummary();
  renderCharts();
  renderLanduseSummary();
  renderPlanSummary();
}

function invalidateScopePreview() {
  state.basics.centerLat = "";
  state.basics.centerLng = "";
  updateMapStatus('입력값이 바뀌었습니다. "지도 범위 표시" 버튼을 눌러 다시 반영해 주세요.');
}

function renderScopeSummary() {
  const summary = document.getElementById("scope-summary");
  const meta = document.getElementById("scope-meta");
  const address = safe(state.basics.siteAddress);
  const width = toNumber(state.basics.rectWidth);
  const height = toNumber(state.basics.rectHeight);
  const cityName = safe(state.basics.cityName) || "대상 도시";

  meta.innerHTML = "";

  if (!address && !width && !height) {
    summary.textContent = "주소지와 가로·세로 범위를 입력하면 조사 범위 요약이 여기에 표시됩니다.";
    return;
  }

  if (!address) {
    summary.textContent = "주소지를 입력해 중심점을 정해 주세요.";
    return;
  }

  if (width <= 0 || height <= 0) {
    summary.textContent = "가로 범위와 세로 범위를 모두 1m 이상으로 입력해 주세요.";
    return;
  }

  const area = width * height;
  const centerText = state.basics.centerLat && state.basics.centerLng
    ? `중심 좌표는 (${state.basics.centerLat}, ${state.basics.centerLng})입니다.`
    : '지도 범위를 표시하면 좌표가 함께 기록됩니다.';

  summary.textContent = `${cityName}의 조사 범위는 "${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m의 직사각형으로 설정됩니다. ${centerText}`;

  [
    `중심 주소: ${address}`,
    `가로: ${formatNumber(width)}m`,
    `세로: ${formatNumber(height)}m`,
    `면적: ${formatNumber(area)}㎡`,
  ].forEach((text) => meta.appendChild(createMetaChip(text)));

  if (state.basics.centerLat && state.basics.centerLng) {
    meta.appendChild(createMetaChip(`중심 좌표: ${state.basics.centerLat}, ${state.basics.centerLng}`));
  }
}

function createMetaChip(text) {
  const chip = document.createElement("span");
  chip.className = "meta-chip";
  chip.textContent = text;
  return chip;
}

function renderRoadRows() {
  const root = document.getElementById("road-rows");
  root.innerHTML = "";

  state.roads.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.appendChild(createSelectCell(ROAD_CLASSES, row.roadClass, (value) => {
      state.roads[index].roadClass = value;
    }));
    tr.appendChild(createInputCell(row.name, "예: 경수대로", (value) => {
      state.roads[index].name = value;
    }));
    tr.appendChild(createInputCell(row.startAddress, "기점 주소", (value) => {
      state.roads[index].startAddress = value;
    }));
    tr.appendChild(createInputCell(row.endAddress, "종점 주소", (value) => {
      state.roads[index].endAddress = value;
    }));
    tr.appendChild(createInputCell(row.source, "예: 도로 현황도", (value) => {
      state.roads[index].source = value;
    }));
    tr.appendChild(createRemoveCell(() => {
      removeRow(state.roads, index, () => createRoadRow({ roadClass: "로" }));
      renderRoadRows();
      refreshComputedOutputs();
      saveState();
    }));
    root.appendChild(tr);
  });
}

function renderSurveyRows() {
  const root = document.getElementById("survey-rows");
  root.innerHTML = "";

  state.surveyPoints.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.appendChild(createInputCell(row.pointName, "예: 수원시청사거리", (value) => {
      state.surveyPoints[index].pointName = value;
    }));
    tr.appendChild(createInputCell(row.jurisdiction, "예: 수원시", (value) => {
      state.surveyPoints[index].jurisdiction = value;
    }));
    tr.appendChild(createInputCell(row.distanceKm, "예: 1.8", (value) => {
      state.surveyPoints[index].distanceKm = value;
    }, "number"));
    tr.appendChild(createSelectCell(SURVEY_TYPES.map((item) => item.label), surveyTypeLabel(row.dataType), (value) => {
      state.surveyPoints[index].dataType = surveyTypeValue(value);
    }));
    tr.appendChild(createTextareaCell(row.note, "예: 첨두시간 07~09시 확인 가능", (value) => {
      state.surveyPoints[index].note = value;
    }));
    tr.appendChild(createInputCell(row.source, "예: 수시 교통량 조사자료", (value) => {
      state.surveyPoints[index].source = value;
    }));
    tr.appendChild(createRemoveCell(() => {
      removeRow(state.surveyPoints, index, createSurveyRow);
      renderSurveyRows();
      refreshComputedOutputs();
      saveState();
    }));
    root.appendChild(tr);
  });
}

function renderLanduseRows() {
  const root = document.getElementById("landuse-rows");
  root.innerHTML = "";

  LANDUSE_CATEGORIES.forEach((category) => {
    const tr = document.createElement("tr");
    tr.dataset.rankKey = category;
    tr.appendChild(createStaticCell(category));
    tr.appendChild(createInputCell(state.landuseAreas[category] || "", "면적 입력", (value) => {
      state.landuseAreas[category] = value;
    }, "number"));
    const ratioCell = createStaticCell("-");
    ratioCell.dataset.landuseRatio = category;
    tr.appendChild(ratioCell);
    root.appendChild(tr);
  });

  const totalRow = document.createElement("tr");
  totalRow.className = "total-row";
  totalRow.appendChild(createStaticCell("계"));
  const totalAreaCell = createStaticCell("0");
  totalAreaCell.id = "landuse-total-area";
  totalRow.appendChild(totalAreaCell);
  const totalRatioCell = createStaticCell("-");
  totalRatioCell.id = "landuse-total-ratio";
  totalRow.appendChild(totalRatioCell);
  root.appendChild(totalRow);
}

function renderZoningRows() {
  const root = document.getElementById("zoning-rows");
  root.innerHTML = "";

  state.zoningRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.dataset.zoningIndex = String(index);
    tr.appendChild(createInputCell(row.name, "예: 주거지역", (value) => {
      state.zoningRows[index].name = value;
    }));
    tr.appendChild(createInputCell(row.area, "면적 입력", (value) => {
      state.zoningRows[index].area = value;
    }, "number"));
    const ratioCell = createStaticCell("-");
    ratioCell.dataset.zoningRatio = String(index);
    tr.appendChild(ratioCell);
    tr.appendChild(createRemoveCell(() => {
      removeRow(state.zoningRows, index, createZoningRow);
      renderZoningRows();
      refreshComputedOutputs();
      saveState();
    }));
    root.appendChild(tr);
  });

  const totalRow = document.createElement("tr");
  totalRow.className = "total-row";
  totalRow.appendChild(createStaticCell("계"));
  const totalAreaCell = createStaticCell("0");
  totalAreaCell.id = "zoning-total-area";
  totalRow.appendChild(totalAreaCell);
  const totalRatioCell = createStaticCell("-");
  totalRatioCell.id = "zoning-total-ratio";
  totalRow.appendChild(totalRatioCell);
  totalRow.appendChild(document.createElement("td"));
  root.appendChild(totalRow);
}

function renderTrafficPlanRows() {
  const root = document.getElementById("traffic-plan-rows");
  root.innerHTML = "";

  state.trafficPlans.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.appendChild(createInputCell(row.title, "예: 시내부 간선도로망 계획", (value) => {
      state.trafficPlans[index].title = value;
    }));
    tr.appendChild(createInputCell(row.relatedPlan, "예: 2030 도시기본계획", (value) => {
      state.trafficPlans[index].relatedPlan = value;
    }));
    tr.appendChild(createTextareaCell(row.description, "예: 교차로 개량 및 도로 확장 계획", (value) => {
      state.trafficPlans[index].description = value;
    }));
    tr.appendChild(createInputCell(row.source, "예: 시청 교통정책과", (value) => {
      state.trafficPlans[index].source = value;
    }));
    tr.appendChild(createRemoveCell(() => {
      removeRow(state.trafficPlans, index, createTrafficPlanRow);
      renderTrafficPlanRows();
      refreshComputedOutputs();
      saveState();
    }));
    root.appendChild(tr);
  });
}

function renderConstructionRows() {
  const root = document.getElementById("construction-plan-rows");
  root.innerHTML = "";

  state.constructionPlans.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.appendChild(createInputCell(row.title, "예: 경수대로 확장공사", (value) => {
      state.constructionPlans[index].title = value;
    }));
    tr.appendChild(createInputCell(row.location, "예: 수원시청~인계사거리", (value) => {
      state.constructionPlans[index].location = value;
    }));
    tr.appendChild(createInputCell(row.status, "예: 공사중", (value) => {
      state.constructionPlans[index].status = value;
    }));
    tr.appendChild(createInputCell(row.source, "예: 도로과 보도자료", (value) => {
      state.constructionPlans[index].source = value;
    }));
    tr.appendChild(createRemoveCell(() => {
      removeRow(state.constructionPlans, index, createConstructionPlanRow);
      renderConstructionRows();
      refreshComputedOutputs();
      saveState();
    }));
    root.appendChild(tr);
  });
}

function updateLanduseTableDisplay() {
  const stats = computeLanduseStats();
  LANDUSE_CATEGORIES.forEach((category) => {
    const ratioCell = document.querySelector(`[data-landuse-ratio="${category}"]`);
    if (ratioCell) ratioCell.textContent = formatPercent(stats.ratioMap.get(category));
    applyRankClass(document.querySelector(`[data-rank-key="${category}"]`), stats.rankMap.get(category));
  });
  const totalAreaCell = document.getElementById("landuse-total-area");
  const totalRatioCell = document.getElementById("landuse-total-ratio");
  if (totalAreaCell) totalAreaCell.textContent = formatNumber(stats.total);
  if (totalRatioCell) totalRatioCell.textContent = stats.total > 0 ? "100.0%" : "-";
}

function updateZoningTableDisplay() {
  const stats = computeZoningStats();
  state.zoningRows.forEach((_, index) => {
    const ratioCell = document.querySelector(`[data-zoning-ratio="${index}"]`);
    if (ratioCell) ratioCell.textContent = formatPercent(stats.ratioMap.get(index));
    applyRankClass(document.querySelector(`[data-zoning-index="${index}"]`), stats.rankMap.get(index));
  });
  const totalAreaCell = document.getElementById("zoning-total-area");
  const totalRatioCell = document.getElementById("zoning-total-ratio");
  if (totalAreaCell) totalAreaCell.textContent = formatNumber(stats.total);
  if (totalRatioCell) totalRatioCell.textContent = stats.total > 0 ? "100.0%" : "-";
}

function applyRankClass(row, rank) {
  if (!row) return;
  row.classList.remove("rank-1", "rank-2", "rank-3");
  if (rank) row.classList.add(`rank-${rank}`);
}

function renderRoadSummary() {
  const output = document.getElementById("road-summary");
  const address = safe(state.basics.siteAddress);
  const width = toNumber(state.basics.rectWidth);
  const height = toNumber(state.basics.rectHeight);
  const cityName = safe(state.basics.cityName) || "대상지";
  const filledRoads = state.roads.filter((row) => isFilled(row.name) || isFilled(row.startAddress) || isFilled(row.endAddress));
  const lines = [];

  if (address && width > 0 && height > 0) {
    lines.push(`${cityName} 가로망 조사는 "${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m 범위 안에서 수행한다.`);
  } else {
    lines.push("기본 정보에서 주소지와 가로·세로 범위를 입력해 조사 범위를 먼저 설정한다.");
  }

  lines.push("조사 대상 도로 구분은 고속도로, 대로, 로를 기본 기준으로 한다.");

  if (state.basics.centerLat && state.basics.centerLng) {
    lines.push(`중심 좌표는 위도 ${state.basics.centerLat}, 경도 ${state.basics.centerLng}이다.`);
  }

  if (!filledRoads.length) {
    lines.push("범위 검토 후 도로명, 기점 주소, 종점 주소를 입력한다.");
  } else {
    filledRoads.forEach((row, index) => {
      const source = safe(row.source) ? ` / 출처: ${row.source}` : "";
      lines.push(`${index + 1}. [${row.roadClass}] ${safe(row.name) || "도로명 미입력"} / 기점: ${safe(row.startAddress) || "기점 주소 미입력"} / 종점: ${safe(row.endAddress) || "종점 주소 미입력"}${source}`);
    });
  }

  output.value = lines.join("\n");
}

function renderSurveySummary() {
  const priorityResult = document.getElementById("survey-priority-result");
  const priorityNote = document.getElementById("survey-priority-note");
  const output = document.getElementById("survey-summary");
  const selected = selectSurveyPoint();
  const filledRows = state.surveyPoints.filter((row) => isFilled(row.pointName) || isFilled(row.jurisdiction) || isFilled(row.distanceKm) || row.dataType !== "time" || isFilled(row.note) || isFilled(row.source));
  const lines = [];

  if (!filledRows.length) {
    priorityResult.textContent = "아직 조사지점이 없습니다.";
    priorityNote.textContent = "가까운 수시 교통량 조사지점을 입력하면 우선순위를 자동으로 판단합니다.";
    output.value = "조사지점 후보를 입력해 주세요.";
    return;
  }

  if (!selected || selected.dataType === "none") {
    priorityResult.textContent = "적정 조사지점 미확보";
    priorityNote.textContent = "1순위와 2순위 자료 유형이 모두 확인되지 않아 현 단계에서는 적정 조사지점을 찾지 못했습니다.";
  } else {
    priorityResult.textContent = `${safe(selected.pointName) || "지점명 미입력"} 우선 검토`;
    priorityNote.textContent = selected.dataType === "time"
      ? "요일별 시간대별 교통량 자료가 확인되어 1순위로 선정했습니다."
      : "요일별 시간대별 교통량 자료는 없지만, 요일별 평균 교통량 자료가 있어 2순위로 선정했습니다.";
  }

  if (selected && selected.dataType !== "none") {
    lines.push(`가장 우선 검토할 사전조사지점은 ${safe(selected.pointName) || "지점명 미입력"}이며, 자료 유형은 ${surveyTypeLabel(selected.dataType)}이다.`);
  } else {
    lines.push("현재 입력 기준으로는 1순위와 2순위 조건을 만족하는 사전조사지점을 찾지 못했다.");
  }

  filledRows.slice().sort(compareSurveyRows).forEach((row, index) => {
    const source = safe(row.source) ? ` / 출처: ${row.source}` : "";
    const note = safe(row.note) ? ` / 비고: ${row.note}` : "";
    lines.push(`${index + 1}. ${safe(row.pointName) || "지점명 미입력"} / 관할: ${safe(row.jurisdiction) || "-"} / 거리: ${formatDistance(row.distanceKm)} / 자료 유형: ${surveyTypeLabel(row.dataType)}${note}${source}`);
  });

  output.value = lines.join("\n");
}

function renderLanduseSummary() {
  const output = document.getElementById("landuse-summary");
  const landuseStats = computeLanduseStats();
  const zoningStats = computeZoningStats();
  const cityName = safe(state.basics.cityName) || "대상 도시";
  const lines = [
    `${cityName}의 지목별 토지이용현황과 용도지역 현황을 면적과 구성비 기준으로 정리했다.`,
    landuseStats.total > 0
      ? `지목별 토지이용 총면적은 ${formatNumber(landuseStats.total)}㎡이며, 상위 항목은 ${topLabels(landuseStats.entries, landuseStats.total) || "집계 중"}이다.`
      : "지목별 토지이용 면적이 아직 입력되지 않았다.",
    zoningStats.total > 0
      ? `용도지역 총면적은 ${formatNumber(zoningStats.total)}㎡이며, 상위 항목은 ${topLabels(zoningStats.entries, zoningStats.total) || "집계 중"}이다.`
      : "용도지역 면적이 아직 입력되지 않았다.",
    `토지이용 출처: ${safe(state.landuseSource) || "미입력"}`,
    `용도지역 출처: ${safe(state.zoningSource) || "미입력"}`,
  ];
  output.value = lines.join("\n");
}

function renderPlanSummary() {
  const output = document.getElementById("plan-summary");
  const trafficPlans = state.trafficPlans.filter((row) => isFilled(row.title) || isFilled(row.relatedPlan) || isFilled(row.description));
  const constructionPlans = state.constructionPlans.filter((row) => isFilled(row.title) || isFilled(row.location) || isFilled(row.status));
  const cityName = safe(state.basics.cityName) || "대상 도시";
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

  output.value = lines.join("\n");
}

function renderCharts() {
  const landuseStats = computeLanduseStats();
  const zoningStats = computeZoningStats();
  renderPie("landuse-chart", "landuse-legend", landuseStats.entries, landuseStats.total, "입력된 지목별 면적이 없습니다.");
  renderPie("zoning-chart", "zoning-legend", zoningStats.entries, zoningStats.total, "입력된 용도지역 면적이 없습니다.");
  document.getElementById("landuse-total-text").textContent = landuseStats.total > 0 ? `총면적 ${formatNumber(landuseStats.total)}㎡` : "총면적 미입력";
  document.getElementById("zoning-total-text").textContent = zoningStats.total > 0 ? `총면적 ${formatNumber(zoningStats.total)}㎡` : "총면적 미입력";
}

function renderPie(chartId, legendId, entries, total, emptyMessage) {
  const chart = document.getElementById(chartId);
  const legend = document.getElementById(legendId);
  const positiveEntries = entries.filter((entry) => entry.value > 0);

  if (!positiveEntries.length || total <= 0) {
    chart.style.background = "radial-gradient(circle at center, rgba(255, 255, 255, 0.95) 0 34%, transparent 35%), conic-gradient(#d9d4cc 0turn 1turn)";
    legend.innerHTML = `<p class="chart-caption">${emptyMessage}</p>`;
    return;
  }

  let offset = 0;
  const slices = positiveEntries.map((entry, index) => {
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

  chart.style.background = `radial-gradient(circle at center, rgba(255, 255, 255, 0.95) 0 34%, transparent 35%), conic-gradient(${slices.map((slice) => `${slice.color} ${slice.start}turn ${slice.end}turn`).join(", ")})`;
  legend.innerHTML = "";

  slices.forEach((slice) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = slice.color;
    const label = document.createElement("span");
    label.textContent = slice.label;
    const percent = document.createElement("strong");
    percent.textContent = `${formatPercent(slice.percent)} / ${formatNumber(slice.value)}㎡`;
    item.appendChild(swatch);
    item.appendChild(label);
    item.appendChild(percent);
    legend.appendChild(item);
  });
}

function computeLanduseStats() {
  return buildStats(LANDUSE_CATEGORIES.map((category) => ({
    key: category,
    label: category,
    value: toNumber(state.landuseAreas[category]),
  })));
}

function computeZoningStats() {
  return buildStats(state.zoningRows.map((row, index) => ({
    key: index,
    label: safe(row.name) || `용도지역 ${index + 1}`,
    value: toNumber(row.area),
  })));
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

function selectSurveyPoint() {
  return state.surveyPoints
    .filter((row) => isFilled(row.pointName) || isFilled(row.jurisdiction) || isFilled(row.distanceKm))
    .slice()
    .sort(compareSurveyRows)[0] || null;
}

function compareSurveyRows(a, b) {
  const priorityDiff = surveyPriority(a.dataType) - surveyPriority(b.dataType);
  if (priorityDiff !== 0) return priorityDiff;
  const distanceDiff = toSortableNumber(a.distanceKm) - toSortableNumber(b.distanceKm);
  if (distanceDiff !== 0) return distanceDiff;
  return safe(a.pointName).localeCompare(safe(b.pointName), "ko");
}

function surveyPriority(type) {
  if (type === "time") return 1;
  if (type === "average") return 2;
  return 3;
}

function surveyTypeLabel(type) {
  return SURVEY_TYPES.find((item) => item.value === type)?.label || SURVEY_TYPES[0].label;
}

function surveyTypeValue(label) {
  return SURVEY_TYPES.find((item) => item.label === label)?.value || SURVEY_TYPES[0].value;
}

function topLabels(entries, total) {
  return entries
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((entry) => `${entry.label} ${formatPercent(total > 0 ? (entry.value / total) * 100 : 0)}`)
    .join(", ");
}

function createStaticCell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function createInputCell(value, placeholder, onChange, type = "text") {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = type;
  input.value = value || "";
  input.placeholder = placeholder;
  input.addEventListener("input", (event) => {
    onChange(event.target.value.trim());
    refreshComputedOutputs();
    saveState();
  });
  td.appendChild(input);
  return td;
}

function createTextareaCell(value, placeholder, onChange) {
  const td = document.createElement("td");
  const textarea = document.createElement("textarea");
  textarea.rows = 3;
  textarea.value = value || "";
  textarea.placeholder = placeholder;
  textarea.addEventListener("input", (event) => {
    onChange(event.target.value.trim());
    refreshComputedOutputs();
    saveState();
  });
  td.appendChild(textarea);
  return td;
}

function createSelectCell(options, value, onChange) {
  const td = document.createElement("td");
  const select = document.createElement("select");
  options.forEach((optionLabel) => {
    const option = document.createElement("option");
    option.value = optionLabel;
    option.textContent = optionLabel;
    select.appendChild(option);
  });
  select.value = value;
  select.addEventListener("change", (event) => {
    onChange(event.target.value);
    refreshComputedOutputs();
    saveState();
  });
  td.appendChild(select);
  return td;
}

function createRemoveCell(onRemove) {
  const td = document.createElement("td");
  td.className = "actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-button";
  button.textContent = "삭제";
  button.addEventListener("click", onRemove);
  td.appendChild(button);
  return td;
}

function removeRow(list, index, factory) {
  list.splice(index, 1);
  if (!list.length) list.push(factory());
}

async function renderScopeMap() {
  const key = safe(state.basics.kakaoJsKey);
  const address = safe(state.basics.siteAddress);
  const width = toNumber(state.basics.rectWidth);
  const height = toNumber(state.basics.rectHeight);

  if (!key) {
    updateMapStatus("카카오 지도 JavaScript 키를 먼저 입력해 주세요.");
    updateStatus("지도 범위를 표시하지 못했습니다.");
    return;
  }
  if (!address) {
    updateMapStatus("중심점으로 사용할 주소지를 입력해 주세요.");
    updateStatus("지도 범위를 표시하지 못했습니다.");
    return;
  }
  if (width <= 0 || height <= 0) {
    updateMapStatus("가로 범위와 세로 범위를 모두 1m 이상으로 입력해 주세요.");
    updateStatus("지도 범위를 표시하지 못했습니다.");
    return;
  }

  try {
    updateMapStatus("카카오 지도 SDK를 불러오는 중입니다.");
    updateStatus("조사 범위를 지도에 표시하는 중입니다.");
    await loadKakaoSdk(key);
    const result = await geocodeAddress(address);
    const lat = Number(result.y);
    const lng = Number(result.x);
    state.basics.centerLat = lat.toFixed(6);
    state.basics.centerLng = lng.toFixed(6);

    const boundsData = computeRectangleBounds(lat, lng, width, height);
    const center = new window.kakao.maps.LatLng(lat, lng);
    const sw = new window.kakao.maps.LatLng(boundsData.south, boundsData.west);
    const ne = new window.kakao.maps.LatLng(boundsData.north, boundsData.east);
    const bounds = new window.kakao.maps.LatLngBounds(sw, ne);

    if (!mapState.map) {
      mapState.map = new window.kakao.maps.Map(document.getElementById("map"), {
        center,
        level: 5,
      });
    }

    clearMapOverlays();

    mapState.marker = new window.kakao.maps.Marker({ position: center, map: mapState.map });
    mapState.rectangle = new window.kakao.maps.Rectangle({
      bounds,
      strokeWeight: 2,
      strokeColor: "#0b4f8a",
      strokeOpacity: 0.9,
      strokeStyle: "solid",
      fillColor: "#0b4f8a",
      fillOpacity: 0.12,
    });
    mapState.rectangle.setMap(mapState.map);

    mapState.infoWindow = new window.kakao.maps.InfoWindow({
      content: `<div style="padding:10px 12px;font-size:13px;line-height:1.5;"><strong>${escapeHtml(address)}</strong><br>가로 ${formatNumber(width)}m / 세로 ${formatNumber(height)}m</div>`,
    });
    mapState.infoWindow.open(mapState.map, mapState.marker);
    mapState.map.setBounds(bounds, 48, 48, 48, 48);

    refreshComputedOutputs();
    saveState();
    updateMapStatus(`"${address}"를 중심으로 가로 ${formatNumber(width)}m, 세로 ${formatNumber(height)}m 범위를 지도에 표시했습니다.`);
    updateStatus("지도 범위를 갱신했습니다.");
  } catch (error) {
    console.error(error);
    updateMapStatus(error.message || "지도 표시 중 오류가 발생했습니다.");
    updateStatus("지도 범위를 표시하지 못했습니다.");
  }
}

function clearMapOverlays() {
  if (mapState.marker) {
    mapState.marker.setMap(null);
    mapState.marker = null;
  }
  if (mapState.rectangle) {
    mapState.rectangle.setMap(null);
    mapState.rectangle = null;
  }
  if (mapState.infoWindow) {
    mapState.infoWindow.close();
    mapState.infoWindow = null;
  }
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

function loadKakaoSdk(key) {
  if (window.kakao?.maps?.services) {
    if (mapState.loadedKey && mapState.loadedKey !== key) {
      return Promise.reject(new Error("카카오 지도 키가 바뀌었습니다. 새 키를 사용하려면 페이지를 새로고침해 주세요."));
    }
    mapState.loadedKey = key;
    return Promise.resolve(window.kakao);
  }

  if (mapState.sdkPromise) {
    if (mapState.loadedKey !== key) {
      return Promise.reject(new Error("카카오 지도 키가 바뀌었습니다. 새 키를 사용하려면 페이지를 새로고침해 주세요."));
    }
    return mapState.sdkPromise;
  }

  mapState.loadedKey = key;
  mapState.sdkPromise = new Promise((resolve, reject) => {
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
    mapState.sdkPromise = null;
    throw error;
  });

  return mapState.sdkPromise;
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

function normalizeAddress(address) {
  return safe(address).replace(/\s+/g, " ");
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
        resolve({
          x: result[0].x,
          y: result[0].y,
          address_name: result[0].address_name || keyword,
          place_name: result[0].place_name || "",
        });
        return;
      }
      reject(new Error("keyword search failed"));
    }, { size: 1 });
  });
}

function fillSampleData() {
  Object.assign(state, createBlankState());
  state.basics = {
    ...createBlankBasics(),
    cityName: "수원시",
    jurisdictionName: "경기도 수원시청",
    siteAddress: "경기도 수원시 팔달구 효원로 241",
    rectWidth: "1200",
    rectHeight: "800",
    baseDate: new Date().toISOString().slice(0, 10),
    kakaoJsKey: "",
    projectNote: "통계연보 및 도시계획 자료 기준",
  };
  state.roads = [
    createRoadRow({ roadClass: "고속도로", name: "영동고속도로", startAddress: "수원신갈IC", endAddress: "동수원IC", source: "국가교통정보센터" }),
    createRoadRow({ roadClass: "대로", name: "경수대로", startAddress: "인계사거리", endAddress: "매교사거리", source: "수원시 도로현황도" }),
    createRoadRow({ roadClass: "로", name: "효원로", startAddress: "수원시청", endAddress: "인계동 일원", source: "수원시 도로현황도" }),
  ];
  state.surveyPoints = [
    createSurveyRow({ pointName: "수원시청사거리", jurisdiction: "수원시", distanceKm: "0.7", dataType: "time", note: "첨두시 확인 가능", source: "수시 교통량 조사자료" }),
    createSurveyRow({ pointName: "인계사거리", jurisdiction: "수원시", distanceKm: "1.4", dataType: "average", note: "요일별 평균교통량만 확인", source: "교통량 통계자료" }),
  ];
  state.landuseSource = "수원시 통계연보 2025";
  state.zoningSource = "수원시 도시계획 자료 2025";
  state.landuseAreas = { 전: "220000", 답: "135000", 임야: "180000", 대지: "460000", 도로: "290000", 하천: "64000", 학교: "38000", 공원: "52000", 기타: "91000" };
  state.zoningRows = [
    createZoningRow({ name: "주거지역", area: "510000" }),
    createZoningRow({ name: "상업지역", area: "120000" }),
    createZoningRow({ name: "공업지역", area: "90000" }),
    createZoningRow({ name: "녹지지역", area: "310000" }),
    createZoningRow({ name: "관리지역", area: "70000" }),
    createZoningRow({ name: "기타", area: "110000" }),
  ];
  state.trafficPlans = [
    createTrafficPlanRow({ title: "시내부 간선도로 체계 정비", relatedPlan: "2030 수원시 도시기본계획", description: "주요 간선축 교차로 운영 개선 및 연결성 강화", source: "수원시 도시계획 보고서" }),
  ];
  state.constructionPlans = [
    createConstructionPlanRow({ title: "경수대로 확장공사", location: "수원시청 일원", status: "공사중", source: "도로과 보도자료" }),
  ];

  clearMapOverlays();
  renderAll();
  saveState();
  updateMapStatus('샘플 데이터를 채웠습니다. 카카오 지도 키를 입력하면 바로 범위를 표시할 수 있습니다.');
  updateStatus("샘플 데이터를 반영했습니다.");
}

function resetAll() {
  if (!window.confirm("입력된 내용을 모두 초기화할까요?")) return;

  Object.assign(state, createBlankState());
  ensureBaseDate();
  seedMinimumRows();
  clearMapOverlays();
  if (mapState.map) {
    mapState.map = null;
    document.getElementById("map").innerHTML = "";
  }
  renderAll();
  saveState();
  updateMapStatus('카카오 지도 JavaScript 키와 주소지를 입력한 뒤 "지도 범위 표시" 버튼을 눌러 주세요.');
  updateStatus("모든 입력값을 초기화했습니다.");
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    Object.assign(state, createBlankState(), JSON.parse(raw));
  } catch (error) {
    console.error(error);
  }
}

async function copyText(text, button) {
  if (!text) {
    flash(button, "복사할 내용 없음");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    flash(button, "복사 완료");
  } catch (error) {
    fallbackCopy(text);
    flash(button, "복사 완료");
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function flash(button, message) {
  const original = button.textContent;
  button.textContent = message;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function updateStatus(message) {
  document.getElementById("status-text").textContent = message;
}

function updateMapStatus(message) {
  document.getElementById("map-status").textContent = message;
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

function safe(value) {
  return String(value || "").trim();
}

function isFilled(value) {
  return safe(value) !== "";
}

function escapeHtml(text) {
  return safe(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
