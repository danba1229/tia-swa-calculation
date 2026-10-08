'use client';
import { useState } from 'react';
import Image from 'next/image';

export default function PoliceSignChart() {
  const [zoom, setZoom] = useState(100);
  const [failed, setFailed] = useState(false);
  return <aside className="police-chart" aria-label="경찰청 교통안전시설 일람표">
    <div className="police-chart-heading"><div><p className="eyebrow">REFERENCE · 2023.12</p><h3>경찰청 교통안전시설 일람표</h3></div><a href="/reference/police-sign-chart-2023-12.pdf" target="_blank" rel="noreferrer">PDF 열기 ↗</a></div>
    <div className="police-chart-tools" role="group" aria-label="일람표 확대 배율">
      <button type="button" onClick={() => setZoom(v => Math.max(100, v - 100))} disabled={zoom === 100} aria-label="일람표 축소">−</button>
      <output aria-live="polite">{zoom}%</output>
      <button type="button" onClick={() => setZoom(v => Math.min(800, v + 100))} disabled={zoom === 800} aria-label="일람표 확대">+</button>
      <button type="button" onClick={() => setZoom(100)}>전체 보기</button><span>확대 후 가로·세로로 이동</span>
    </div>
    <div className="police-chart-viewport" tabIndex={0} aria-label="일람표 이미지 스크롤 영역">
      {failed ? <p role="alert">일람표 이미지를 불러오지 못했습니다. 위의 PDF를 열어 확인해 주세요.</p> : <Image unoptimized src="/reference/police-sign-chart-2023-12.webp" alt="경찰청 교통안전시설 일람표, 2023년 12월 시행. 주의·규제·지시·보조표지와 노면표시의 번호 및 그림. 상세 내용은 PDF에서 확인할 수 있습니다." width={3136} height={4400} style={{ width: `${zoom}%`, maxWidth: 'none', height: 'auto' }} onError={() => setFailed(true)} />}
    </div>
    <p className="police-chart-source"><a href="https://www.police.go.kr/user/bbs/BD_selectBbs.do?q_bbsCode=1001&q_bbscttSn=20240521062714460" target="_blank" rel="noreferrer">출처: 경찰청 · 공식 게시글 ↗</a><br />2023.12 시행판 · 공개 재게시본 2곳의 동일 파일 대조. 공식 서버 원본과의 대조 및 이후 개정 확인은 미완료입니다.</p>
  </aside>;
}
