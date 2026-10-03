# TIA Research Builder

## 서울 버스정류장 조사

STEP5의 `POST /api/seoul-bus`는 서울시 공식 XLSX 자료를 변환한 `data/seoul-bus-snapshot.json`을 사용합니다. 기준일은 2026-09-02이며 실시간 자료가 아닙니다. 인증키와 외부 API 연결 없이 조사 직사각형 안의 정류장 전체, 직선거리, 고유 정차 노선을 표시합니다. 자료 기준일은 화면과 CSV/표 복사 결과에 포함합니다.

- 출처: [정류소 위치정보](https://data.seoul.go.kr/dataList/OA-15067/S/1/datasetView.do), [노선별 정류소정보](https://data.seoul.go.kr/dataList/OA-1095/S/1/datasetView.do).
- 정류소 NODE_ID로만 연결하며 동일 노선 중복 정차는 한 건으로 정리합니다. 한강선착장은 제외합니다. 정류소 마스터에 없는 노선 행은 제외하고 생성 파일 diagnostics에 개수를 기록합니다.
- 버스종류, 기종점, 첫차, 막차, 배차간격은 파일에 없으므로 추정하지 않고 수동 확인 상태로 표시합니다. 연결된 노선이 없는 정류장도 삭제하지 않습니다.
- 갱신: 공식 파일의 기준일/다운로드 식별자를 확인해 `scripts/import_seoul_bus_snapshot.mjs`를 갱신하고 `node scripts/import_seoul_bus_snapshot.mjs`로 재생성 후 재배포합니다. 매 검색마다 최신 파일을 다운로드하는 방식은 아닙니다.
- `lib/seoulBus.js`는 향후 HTTPS API 연결을 위한 별도 모듈로 남아 있으며 현재 기본 조회에서는 호출하지 않습니다. `SEOUL_BUS_API_KEY`도 현재 파일 조회에는 필요하지 않습니다.

Next.js App Router 기반 교통영향평가 조사 초안 작성 보조 웹앱입니다. 주소지를 입력하면 조사 범위, 가로망, 사전조사지점, 토지이용 및 용도지역, 주변지역 개발계획, 교통관련 계획을 한 화면에서 정리할 수 있습니다.

## 1차 버전 범위

- 카카오 지도 JavaScript SDK로 사업지와 조사 범위를 표시합니다.
- KOSIS 수록기간 자료로 지목별 토지이용현황과 용도지역 현황을 표/그래프/엑셀로 정리합니다.
- 주변지역 개발계획은 카카오 Local API, 국토교통부_교통영향평가_사업정보 API, 국토교통부_교통영향평가정보지원시스템 API를 사용합니다.
- 대중교통/교통시설 현황의 따릉이 대여소는 `서울특별시_공공자전거 대여소 정보(25.12월 기준)` 마스터 파일을 앱 내부 데이터로 변환해 사용합니다.
- `/embed` 경로는 티스토리 iframe 삽입용 간소화 화면입니다.

## 제외 기능

- 지자체 고시공고 자동검색은 1차 버전에 포함하지 않습니다.
- 토지이음, 건축인허가, 정비사업 데이터 연계는 TODO로 남겨둡니다.
- 교통영향평가 API의 정확한 endpoint, 요청변수명, 응답 필드명은 활용신청 후 제공되는 Swagger/활용가이드를 기준으로 `lib/tiaApi.js`에서 조정해야 합니다.

## 환경변수

`.env.local` 또는 Vercel Environment Variables에 아래 값을 설정합니다.

```env
KAKAO_JS_KEY=
KAKAO_REST_API_KEY=
TIA_DATAGOKR=
DATA_GO_KR_SERVICE_KEY=
TIA_PROJECT_API_BASE_URL=
TIA_PROJECT_API_OPERATION_PATH=
TIA_SYSTEM_API_BASE_URL=
TIA_SYSTEM_API_OPERATION_PATH=
TIA_API_BASE_URL=
TIA_API_OPERATION_PATH=
KOSIS_API_KEY=
```

- `KAKAO_JS_KEY`: 화면 지도 표시용 JavaScript 키입니다.
- `KAKAO_REST_API_KEY`: 서버 API Route에서 주소 좌표변환에 사용하는 REST API 키입니다.
- `TIA_DATAGOKR`: 공공데이터포털 인증키입니다. 기존에 이 이름으로 넣어둔 경우 그대로 사용할 수 있습니다.
- `DATA_GO_KR_SERVICE_KEY`: 공공데이터포털 인증키의 보조 이름입니다. `TIA_DATAGOKR`가 있으면 없어도 됩니다.
- `TIA_PROJECT_API_BASE_URL`, `TIA_PROJECT_API_OPERATION_PATH`: 국토교통부_교통영향평가_사업정보 API 활용가이드 확인 후 입력합니다.
- `TIA_SYSTEM_API_BASE_URL`, `TIA_SYSTEM_API_OPERATION_PATH`: 국토교통부_교통영향평가정보지원시스템 API 활용가이드 확인 후 입력합니다.
- `TIA_API_BASE_URL`, `TIA_API_OPERATION_PATH`: 기존 단일 API 설정과 호환하기 위한 값입니다. 새 환경변수가 있으면 없어도 됩니다.
- `DATABASE_URL`: Neon PostgreSQL 연결 문자열입니다. 있으면 주변지역 개발계획 누적 DB를 우선 조회합니다.
- `CRON_SECRET`: Vercel Cron 호출 보호용 비밀값입니다. 설정하면 `Authorization: Bearer {CRON_SECRET}` 요청만 동기화를 허용합니다.
- `KOSIS_API_KEY`: STEP3 KOSIS 자료 추출에 사용합니다.

API 키는 클라이언트 번들에 넣지 않습니다. 카카오 REST API와 공공데이터 API 호출은 모두 Next.js 서버 API Route에서 처리합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## Vercel 배포

1. GitHub 저장소를 Vercel 프로젝트로 연결합니다.
2. Vercel Project Settings에서 위 환경변수를 Production에 추가합니다.
3. `main` 브랜치에 push하면 자동 배포됩니다.
4. 카카오 Developers의 플랫폼 Web 도메인에 Vercel 도메인을 등록합니다.

## 티스토리 iframe 예시

```html
<div class="tia-embed-wrap">
  <iframe
    src="https://tia-support.vercel.app/embed"
    title="교통영향평가 조사 초안 작성 도구"
    data-tia-embed
    loading="lazy"
  ></iframe>
</div>
```

기존 예시는 `tistory-iframe-snippet.html`에도 들어 있습니다.

## 주변지역 개발계획 API

- `POST /api/geocode`: 주소를 카카오 Local API로 좌표 변환합니다.
- `POST /api/tia/search`: 사업지 주소 좌표변환, 누적 DB 우선 조회, DB 미연결/미수집 시 2개 교통영향평가 API 실시간 조회, 후보사업 좌표변환, 거리계산, 반영여부 자동판정을 수행합니다.
- `GET /api/cron/tia-sync`: Vercel Cron 또는 수동 호출로 교통영향평가정보지원시스템 `businessSearch` 자료를 `numOfRows=1` 방식으로 수집해 Neon DB에 누적 저장합니다.

## 주변지역 개발계획 자동조사 1차 구조

### 조사 정확성 및 화면 보완

- 주변사업 검색은 상단 가로·세로와 동일한 사각형으로 최종 필터링합니다. 좌표변환 실패 사업은 별도 보기로 남깁니다.
- `/api/tia/search`는 최대 20건씩 좌표화하고 `pagination.nextOffset` 및 `datasetId`를 반환합니다. 화면은 다음 묶음을 계속 요청하며 수집된 전체 후보를 처리합니다. 중간 실패나 원자료 페이지 누락을 완료/0건으로 확정하지 않습니다.
- 후보 목록이 조회 도중 바뀌면 409 응답으로 재조사를 요청합니다. 후보 캐시는 성능 보조용이며 서버 인스턴스 간 영속 저장소가 아닙니다.
- 주소·범위 변경 및 새 요청은 이전 응답 적용을 차단합니다. 통계연도 변경은 이전 통계 요청만 취소합니다.
- 조사 시작 시 통계·주변사업·교통시설·지도를 독립 실행합니다. 지도 실패가 다른 조사를 막지 않습니다.
- 통계 누락값은 화면과 엑셀에서 빈값으로 유지합니다. 기타 면적은 합계와 모든 주요 항목이 확인될 때만 계산합니다. 원자료 합계가 없고 세부 항목도 누락되면 합계와 구성비를 확정하지 않습니다.
- 지도 접기 버튼으로 표를 넓게 볼 수 있습니다. 작은 화면에서는 표 내부만 가로 스크롤됩니다.
- 회귀 테스트: `node --test --test-isolation=none tests/*.test.mjs` (Windows 자식 프로세스 제한 환경에서도 실행 가능).

### 지도 대중교통 표시

- 지도 상단의 `따릉이 위치 표시`와 `버스정류장 표시`를 각각 켜고 끌 수 있습니다. 서울 대중교통 조회 결과 중 지도에 표시한 사각형 조사 범위 안의 정류장만 주황색 버스 아이콘으로 표시합니다.
- 마우스 올리기 또는 키보드 포커스로 정류장명을 확인하고, 클릭/Enter로 지도 아래 상세정보(정류장번호, 경유 버스번호, 사업지와의 직선거리)를 엽니다. 빈 거리값은 0m로 표시하지 않습니다.
- 정류장과 경유노선은 STEP5와 같은 공식 파일 자료를 사용하며 실시간 도착·운행정보가 아닙니다. 주소/범위 변경, 전체 초기화, 표시 해제 시 이전 마커를 제거합니다. 지도보다 조회가 먼저 완료되어도 지도 생성 후 표시합니다.

### 주변사업 주소 확인 로직

- 원문 주소, 괄호·공백 등을 정리한 주소, 사업명/사업위치 필드에서 추출한 지번 순으로 재검색합니다. 부족한 지자체명은 해당 후보의 위치 자료에서만 보완하며, 검색 중심 사업지 주소를 다른 후보의 주소로 대입하지 않습니다.
- 카카오 상세 주소 유형(`ROAD_ADDR`, `REGION_ADDR`)과 행정구역·건물번호·지번이 일치할 때만 거리와 조사 범위 포함 여부를 계산합니다. 동 대표 좌표, 여러 위치의 검색 결과, 복수 필지, 사업명/위치의 행정구역 충돌은 위치 미확인으로 남깁니다. 상세 주소 일치는 사업의 전체 부지 경계까지 검증했다는 뜻은 아닙니다.
- 원자료 위치는 변경하지 않습니다. 결과표와 CSV의 `좌표 확인`, `확인 주소`에서 조회 방법·검색어·실패 사유를 확인할 수 있습니다. `위치 미확인 사업 포함 보기`를 켜면 거리 미산정 후보도 표시합니다.
- 후보당 최대 6개 검색어, 최대 12초를 사용하며 묶음 처리 시간 안에서 제한합니다. 주소검색 결과 없음과 인증 오류·호출 제한·연결 실패·시간 초과를 구분합니다. 실패 결과는 캐시하지 않고, 성공 결과만 최대 500개/10분 동안 메모리에 보관합니다.

1차 버전은 완전 자동에 가까운 구조를 목표로 하되, 공공 API와 지자체 고시공고의 한계를 UI에서 명확히 표시합니다.

- `businessSearch`는 `numOfRows=1`로 기간별 누적 수집합니다. 공개 API가 `numOfRows=100`에서 같은 사업을 반복 반환하는 현상을 우회하기 위한 방식입니다.
- 수집자료는 `tia_projects` 테이블에 사업번호/사업명/위치 기준으로 중복 제거하여 저장합니다.
- 사용자가 주변사업 검색을 누르면 DB 자료를 먼저 조회하고, DB가 없거나 해당 조건 자료가 없으면 기존 실시간 API 조회로 fallback합니다.
- 지자체 고시공고는 1차에서 공식 사이트를 직접 크롤링하지 않고, 행정구역과 핵심 키워드 기반 검색 링크를 생성하여 수동확인 후보로 표시합니다.

### Neon 연결 후 초기 동기화

Vercel Marketplace에서 Neon을 연결하면 `DATABASE_URL`이 자동으로 생성됩니다. 이후 다음 주소를 호출하면 해당 기간 자료를 수집합니다.

```text
https://tia-support.vercel.app/api/cron/tia-sync?startDate=2026-01-01&endDate=2026-01-31&maxPages=250
```

`CRON_SECRET`을 설정한 경우에는 `Authorization: Bearer {CRON_SECRET}` 헤더가 필요합니다. `vercel.json`에는 매일 03:00(KST)에 현재 월 자료를 동기화하도록 설정되어 있습니다.

공공데이터포털 API 신청 URL:

https://www.data.go.kr/iim/api/selectDevAcountRequestForm.do?publicDataDetailPk=uddi:fe3f4ccd-57ea-4b79-b77a-cdbed1484bf4_202308241603

## 지표·O/D 접근강도 계산기

운영 주소는 `https://tia-support.vercel.app/indicator`다. 기존 조사 도구와 분리된 사용자 로그인 화면에서 상세 주소를 서버의 카카오 REST API로 확인한 뒤, 수도권 1,310존 또는 전국 250존의 검증된 파생 자료를 Python 함수에서 계산한다. 지리적 동서남북 방향은 개별·선택·행정지역 묶음으로 바꿀 수 있으며 결과는 사용자별 Production private Vercel Blob에 저장된다.

필수 서버 환경변수는 `KAKAO_REST_API_KEY`, `TIA_CALCULATOR_SESSION_SECRET`, `TIA_CALCULATOR_INVITE_CODE`다. 민감값을 클라이언트에 노출하지 않는다. Blob은 OIDC 연결을 사용하며 정적 read-write 토큰을 두지 않는다. Python 함수는 서버 내부에서 2분짜리 읽기 전용 URL을 받아 30.37MB 계산자료 묶음을 내려받고, 번들 및 구성 파일 SHA-256을 검증한 뒤 버전 고정 `/tmp` 캐시를 사용한다. 읽기 URL과 내부 임시 경로는 브라우저·로그·결과에 남기지 않는다.

계산 함수에 포함된 자료는 파생 JSON/f64와 검증용 경계뿐이며 원 Excel·ZIP·TXT는 배포하지 않는다. 지표 목표연도와 O/D 시나리오 연도는 독립적이다. 수도권 O/D는 2023년만, 전국 O/D는 등록된 시나리오 연도만 선택한다.

사용자 등록에는 운영 관리자가 별도로 전달하는 등록 승인 코드가 필요하다. 사용자 작업은 사용자 ID 아래에 분리 저장되며, 리비전 충돌과 저장 요청 ID로 다중 탭 덮어쓰기 및 응답 유실 재시도를 방지한다. Blob 상태 읽기는 mutable 자료의 stale 404/이전 리비전을 피하기 위해 원본 읽기를 사용한다.
