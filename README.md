# TIA Research Builder

Next.js App Router 기반의 배포형 TIA 조사 작성 도구입니다.

## 현재 구조

- `app/`
  - Next.js 라우트와 전역 스타일
- `components/TiaResearchBuilder.jsx`
  - 화면 UI, 로컬 저장, 카카오 지도, 계산 로직
- `.env.example`
  - 배포 환경변수 예시

기존 정적 파일인 `index.html`, `app.js`, `style.css`, `serve_local.ps1` 는 참고용으로 남아 있으며, 새 실행 구조에서는 사용하지 않습니다.

## 실행 방법

1. 의존성 설치
   - `npm install`
2. 환경변수 파일 생성
   - `.env.local`
3. 아래 값 설정
   - `KAKAO_JS_KEY=...`
4. 개발 서버 실행
   - `npm run dev`
5. 브라우저에서 열기
   - `http://localhost:3000`

## 배포 메모

- 카카오 Developers Web 플랫폼에 아래 주소를 등록해야 합니다.
  - 개발용 예시: `http://localhost:3000`
  - 배포용 예시: `https://your-domain.com`
- 사용자는 지도 키를 입력하지 않습니다.
- 다만 카카오 지도 JavaScript SDK 특성상 지도 렌더링 시 키가 브라우저 요청에 사용되므로, 완전한 비공개 키처럼 취급할 수는 없습니다.
- 따라서 `도메인 제한`을 반드시 함께 설정해야 합니다.

## 티스토리 임베드

- 임베드 전용 주소는 `/embed` 입니다.
  - 예: `https://your-domain.com/embed`
- 티스토리 HTML 모드에 넣을 예시는 [tistory-iframe-snippet.html](C:/Users/kimys543512/Desktop/tia%20codex/01.%20tia(swa)%20calculation/tistory-iframe-snippet.html) 파일에 넣어두었습니다.
- 티스토리에서 바로 보이게 하려면 블로그 글 본문이나 스킨 HTML 편집 영역에 `iframe` 코드를 넣으면 됩니다.

## 권장 환경변수

```env
KAKAO_JS_KEY=your_kakao_javascript_key
```
