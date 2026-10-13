import { useMemo } from 'react';

export default function SeoulSignReference({ points }) {
  const groups = useMemo(() => {
    const found = new Map();
    for (const point of points) {
      const key = JSON.stringify([point.source, point.sourceIndex]);
      if (!found.has(key)) found.set(key, { key, source: point.source, code: point.sourceIndex, count: 0, remarks: new Set() });
      const group = found.get(key);
      group.count++;
      if (point.sourceRemark && group.remarks.size < 3) group.remarks.add(point.sourceRemark);
    }
    return [...found.values()].sort((a, b) => a.source.localeCompare(b.source) || String(a.code).localeCompare(String(b.code), 'ko', { numeric: true }));
  }, [points]);
  return <aside className="police-chart seoul-sign-reference" aria-label="서울시 원본 코드 목록">
    <div className="police-chart-heading"><div><p className="eyebrow">REFERENCE · SEOUL</p><h3>서울시 원본 코드 목록</h3></div></div>
    <p className="police-chart-source">현재 조사 범위와 표지판 종류에 해당하는 원본 코드입니다. 같은 코드에도 서로 다른 비고가 있을 수 있습니다.</p>
    <div className="seoul-sign-code-list" tabIndex={0} aria-label="서울시 코드 목록 스크롤 영역">
      {groups.length ? <table><thead><tr><th scope="col">원본 코드</th><th scope="col">지점수</th><th scope="col">원본 비고 예시</th></tr></thead><tbody>
        {groups.map(group => <tr key={group.key}><th scope="row">{group.code || '수동확인필요'}<small>{group.source === 'S' ? '안전표지' : '도로표지'}</small></th><td>{group.count.toLocaleString('ko-KR')}</td><td>{[...group.remarks].join(' / ') || '수동확인필요'}</td></tr>)}
      </tbody></table> : <p>주소와 조사 범위를 지정하면 코드 목록이 표시됩니다.</p>}
    </div>
    <p className="police-chart-source">서울시 코드와 경찰청 일람표 번호는 다른 분류 기준입니다. 개별 지점을 선택하면 원본 비고 전체를 확인할 수 있습니다.</p>
  </aside>;
}
