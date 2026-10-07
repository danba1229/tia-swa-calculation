export function investigationStates({ mapPhase, verification, development, transport, accident, pointCount }) {
  const statistics = !verification ? 'idle' : ({ LOADING: 'loading', SUCCESS: 'complete', PARTIAL: 'partial', FAILED: 'failed', DATA_NOT_FOUND: 'partial', CANCELLED: 'idle' }[verification.status] || 'partial');
  const plans = development.loading ? 'loading' : development.error ? (development.results?.length ? 'partial' : 'failed')
    : !development.searched ? 'idle' : development.warnings || !development.complete ? 'partial' : 'complete';
  const facilities = transport.loading || transport.busRouteLoading || transport.busDetailLoading || transport.subwayDetailLoading ? 'loading'
    : !transport.searched ? 'idle' : transport.busError || transport.busDetailError || transport.busRouteError || transport.busSummary?.partial || transport.subwayError || transport.subwayTruncated
      || transport.subwayStations?.some(s => s.error || ['MANUAL_REQUIRED', 'PARTIAL', 'PENDING'].includes(s.status))
      || (transport.error && !transport.transportRegion) ? 'partial' : 'complete';
  const bikes = transport.loading ? 'loading' : !transport.searched ? 'idle' : transport.error ? 'partial' : 'complete';
  return { 1: mapPhase, 2: pointCount ? 'complete' : mapPhase === 'loading' ? 'loading' : mapPhase === 'complete' ? 'partial' : 'idle',
    3: statistics, 4: plans, 5: facilities, 6: bikes, 7: 'manual', 8: accident };
}
export const SURVEY_STATUS_LABELS = { idle: '미확인', loading: '조회 중', complete: '완료', partial: '일부 누락', failed: '실패', stale: '이전 자료', manual: '수동 확인' };
