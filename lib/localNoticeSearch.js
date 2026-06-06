const NOTICE_KEYWORDS = [
  "교통영향평가",
  "도시관리계획",
  "지구단위계획",
  "실시계획인가",
  "건축허가",
  "개발사업",
];

function q(value) {
  return encodeURIComponent(value);
}

export function buildLocalNoticeSearches({ sido = "", sigungu = "", startYear = "", endYear = "" } = {}) {
  const admin = [sido, sigungu].filter(Boolean).join(" ").trim();
  const yearText = [startYear, endYear].filter(Boolean).join("..");
  return NOTICE_KEYWORDS.map((keyword) => {
    const query = [admin, keyword, yearText, "고시공고"].filter(Boolean).join(" ");
    return {
      keyword,
      title: `${admin || "해당 지자체"} ${keyword} 고시공고 확인`,
      url: `https://www.google.com/search?q=${q(query)}`,
      source: "지자체 고시공고 웹검색",
      confidence: "수동확인 필요",
      note: "공식 고시공고 페이지와 첨부 PDF/HWP를 확인해 반영 여부를 판단합니다.",
    };
  });
}

