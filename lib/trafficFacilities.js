import { haversineDistanceMeters } from './distance.js';

export const FACILITY_TYPES = Object.freeze([
  { key: 'signal_intersection', label: '신호교차로', mapLabel: '신호교차로 후보', prefix: '신', color: '#2563eb' },
  { key: 'unsignal_intersection', label: '비신호교차로', prefix: '비', color: '#64748b' },
  { key: 'crosswalk', label: '횡단보도', prefix: '횡', color: '#0891b2' },
  { key: 'footbridge', label: '육교', prefix: '육', color: '#7c3aed' },
  { key: 'roundabout', label: '회전교차로', prefix: '회', color: '#059669' },
  { key: 'bus_stop', label: '버스정류장', prefix: '버', color: '#0369a1' },
  { key: 'speed_hump', label: '과속방지턱', prefix: '턱', color: '#b45309' },
  { key: 'image_hump', label: '이미지험프', prefix: '험', color: '#be185d' },
  { key: 'unknown_intersection', label: '신호구분 미확인', prefix: '미', color: '#78716c' },
]);
export function facilityScope(input) {
  const keys = ['lat', 'lng', 'width', 'height'];
  if (keys.some(k => input[k] == null || String(input[k]).trim() === '' || !Number.isFinite(Number(input[k])))) throw new Error('주소 좌표와 가로·세로 범위를 확인해 주세요.');
  const [lat, lng, width, height] = keys.map(k => Number(input[k]));
  if (!['seoul', 'gyeonggi'].includes(input.region) || lat < 36.8 || lat > 38.4 || lng < 126.2 || lng > 128) throw new Error('서울·경기 주소를 입력해 주세요.');
  if (width < 1 || height < 1 || width > 10000 || height > 10000) throw new Error('가로·세로 범위는 각각 1~10,000m입니다.');
  const dy = height / 222640, dx = width / (222640 * Math.cos(lat * Math.PI / 180));
  return { lat, lng, width, height, region: input.region, north: lat + dy, south: lat - dy, east: lng + dx, west: lng - dx };
}
export function insideFacilityScope(lat, lng, scope) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= scope.south && lat <= scope.north && lng >= scope.west && lng <= scope.east;
}
export function selectFacilityRows(rows, scope) {
  const region = scope.region === 'seoul' ? '서울특별시' : '경기도';
  return rows.filter(r => r[6] === region && insideFacilityScope(r[2], r[3], scope)).map(r => ({ id: r[0], kind: r[1], lat: r[2], lng: r[3], name: r[4], address: r[5], region: r[6], sourceId: r[7], referenceDate: r[8], remark: r[9], positionBasis: r[10] }));
}
export function busFacilityPoints(result, scope) {
  return (result.busStops || []).filter(s => insideFacilityScope(Number(s.latitude), Number(s.longitude), scope)).map(s => ({
    id: `bus:${scope.region}:${s.stationId || s.id}`, kind: 'bus_stop', lat: Number(s.latitude), lng: Number(s.longitude),
    name: `${s.stationName || '정류장명 미확인'}${s.arsId ? `(${s.arsId})` : ''}`, address: '', sourceId: 'bus',
    referenceDate: s.sourceDate || result.sourceDate || '', positionBasis: '공식 정류장 위경도',
    remark: `경유버스: ${(s.routes || []).map(r => r.routeName).filter(Boolean).join(', ') || '수동확인필요'}`,
  }));
}
export function numberFacilityPoints(points, scope, limit = 15000) {
  if (points.length > limit) throw new Error('범위 내 시설이 너무 많습니다. 가로·세로 범위를 줄여 주세요.');
  const ids = new Set(), counters = new Map();
  return [...points].sort((a,b) => b.lat - a.lat || a.lng - b.lng || a.id.localeCompare(b.id, 'en')).filter(p => {
    if (ids.has(p.id)) return false; ids.add(p.id); return true;
  }).map((p,index) => {
    const type = FACILITY_TYPES.find(t => t.key === p.kind);
    if (!type) throw new Error('시설 종류를 확인하지 못했습니다.');
    const n = (counters.get(p.kind) || 0) + 1; counters.set(p.kind,n);
    return { ...p, number:index+1, label:`${type.prefix}${n}`, color:type.color,
      distance: Math.round(haversineDistanceMeters({latitude:scope.lat,longitude:scope.lng},{latitude:p.lat,longitude:p.lng})),
      roadviewUrl:`https://map.kakao.com/link/roadview/${p.lat},${p.lng}` };
  });
}
export function facilityCoverage(region, busState = 'available') {
  const seoul = region === 'seoul';
  const data = seoul ? {
    signal_intersection:['candidate','2025년 교차로·2021년 제어기 연결 후보. 현재 신호 운영은 추가 확인'],
    unsignal_intersection:['unavailable','공식 비신호 운영구분 자료 미확보. 신호자료 미연결을 비신호로 분류하지 않음'],
    crosswalk:['historical','2021년 서울시 SHP. 최근 신설·철거 미반영 가능'],
    footbridge:['partial','2022년 대장 중 정밀 주소가 연결된 육교의 근사위치'],
    roundabout:['unavailable','서울 회전교차로 위치대장 미연결'],
    speed_hump:['snapshot','2025년 서울시 요철형 험프'], image_hump:['snapshot','2025년 서울시 이미지형(도색형) 험프'],
    unknown_intersection:['unclassified','공식 교차로 중 차량 신호 분류 근거 미확인'],
  } : {
    signal_intersection:['unavailable','경기 신호교차로 위치·운영구분 자료 미연결'],
    unsignal_intersection:['unavailable','공식 비신호 운영구분 자료 미확보'],
    crosswalk:['partial','전국 공개 다운로드 5만 행 중 경기 일부 시군 자료. 미수록 지역 있음'],
    footbridge:['unavailable','경기 육교 자료의 좌표계·시설 단위 검증 미완료'],
    roundabout:['partial','2025년 양평군 대장 중 정밀 주소가 연결된 근사위치. 다른 시군 미수록'],
    speed_hump:['unavailable','경기 과속방지턱 위치자료 미연결'], image_hump:['unavailable','경기 도색형 구분이 확인된 위치자료 미연결'],
    unknown_intersection:['unavailable','경기 교차로 기본 위치자료 미연결'],
  };
  data.bus_stop = [busState, busState === 'available' ? '기존 공식 정류장 조회 연동. 사업지 시·도 자료 기준' : '버스정류장 조회 실패. 시설 없음이 아님'];
  return FACILITY_TYPES.map(t => ({ ...t, status:data[t.key][0], note:data[t.key][1] }));
}
export function facilityCsv(points, sources) {
  const escape = value => `"${String(value ?? '').replace(/^\s*[=+@-]/, "'$&").replaceAll('"','""')}"`;
  const rows = [['표시번호','종류','시설명','원본ID','위도','경도','거리(m)','주소','위치근거','자료기준일','파일버전','출처','원본비고','확인상태'], ...points.map(p => {
    const s = sources[p.sourceId] || {}, t = FACILITY_TYPES.find(t => t.key === p.kind);
    return [p.label,t.mapLabel || t.label,p.name,p.id,p.lat,p.lng,p.distance,p.address,p.positionBasis,p.referenceDate || '미확인',s.fileVersion,s.url,p.remark,'추가확인필요'];
  })];
  return '\ufeff'+rows.map(r=>r.map(escape).join(',')).join('\r\n');
}
