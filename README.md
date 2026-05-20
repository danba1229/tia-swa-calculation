# TIA Research Builder

Next.js App Router 기반 교통영향평가 조사 초안 작성 보조 웹앱입니다. 주소지를 입력하면 조사 범위, 가로망, 사전조사지점, 토지이용 및 용도지역, 주변지역 개발계획, 교통관련 계획을 한 화면에서 정리할 수 있습니다.

## 1차 버전 범위

- 카카오 지도 JavaScript SDK로 사업지와 조사 범위를 표시합니다.
- KOSIS 수록기간 자료로 지목별 토지이용현황과 용도지역 현황을 표/그래프/엑셀로 정리합니다.
- 주변지역 개발계획은 카카오 Local API, 국토교통부_교통영향평가_사업정보 API, 국토교통부_교통영향평가정보지원시스템 API를 사용합니다.
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
SEOUL_OPEN_API_KEY=
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
- `SEOUL_OPEN_API_KEY`: STEP5 대중교통/교통시설 현황에서 서울 따릉이 대여소 조회에 사용하는 서울 열린데이터광장 인증키입니다.
- `TIA_DATAGOKR`: 공공데이터포털 인증키입니다. 기존에 이 이름으로 넣어둔 경우 그대로 사용할 수 있습니다.
- `DATA_GO_KR_SERVICE_KEY`: 공공데이터포털 인증키의 보조 이름입니다. `TIA_DATAGOKR`가 있으면 없어도 됩니다.
- `TIA_PROJECT_API_BASE_URL`, `TIA_PROJECT_API_OPERATION_PATH`: 국토교통부_교통영향평가_사업정보 API 활용가이드 확인 후 입력합니다.
- `TIA_SYSTEM_API_BASE_URL`, `TIA_SYSTEM_API_OPERATION_PATH`: 국토교통부_교통영향평가정보지원시스템 API 활용가이드 확인 후 입력합니다.
- `TIA_API_BASE_URL`, `TIA_API_OPERATION_PATH`: 기존 단일 API 설정과 호환하기 위한 값입니다. 새 환경변수가 있으면 없어도 됩니다.
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
- `POST /api/tia/search`: 사업지 주소 좌표변환, 2개 교통영향평가 API 후보사업 조회, 중복 병합, 후보사업 좌표변환, 거리계산, 반영여부 자동판정을 수행합니다.

공공데이터포털 API 신청 URL:

https://www.data.go.kr/iim/api/selectDevAcountRequestForm.do?publicDataDetailPk=uddi:fe3f4ccd-57ea-4b79-b77a-cdbed1484bf4_202308241603
