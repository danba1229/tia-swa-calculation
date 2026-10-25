// The 28 cadastral land categories minus the eight reported separately
// (전·답·임야·대·도로·하천·학교용지·공원) make up the residual "기타".
export const LANDUSE_OTHER_CATEGORIES = Object.freeze([
  "과수원", "목장용지", "광천지", "염전", "공장용지", "주차장", "주유소용지", "창고용지", "철도용지", "제방",
  "구거", "유지", "양어장", "수도용지", "체육용지", "유원지", "종교용지", "사적지", "묘지", "잡종지",
]);

export const LANDUSE_OTHER_NOTE = `기타 = 전체 계 - 주요 8개 지목. 포함 지목: ${LANDUSE_OTHER_CATEGORIES.join("·")}`;

// KOSIS zoning comes from the national urban-planning survey; district yearbooks
// use the district urban-planning division's figures, which can differ.
export const ZONING_SOURCE_NOTE = "KOSIS 도시계획현황(국토교통부 집계) 기준입니다. 시·군·구 통계연보의 용도지역(구청 도시계획과 자료)과 집계 기관·방식이 달라 같은 연도라도 값이 다를 수 있습니다.";
