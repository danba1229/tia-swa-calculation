# TIA Research Builder

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
