const CAPITAL = ['11', '28', '41'];
const LABELS = { direct: '직접 관련', metropolitan: '광역·간접 관련', national: '전국 공통', review: '확인 필요', other: '추가 후보' };

export function planAdminFromGeocode(site) {
  const address = site?.raw?.address;
  const code = String(address?.b_code || '');
  if (!site?.success || !/^\d{10}$/.test(code) || !address?.region_1depth_name || !address?.region_2depth_name && !code.startsWith('36')) {
    throw new Error('사업지의 법정동 코드를 확인하지 못했습니다. 상세 주소로 다시 조회해 주세요.');
  }
  return { code, province: address.region_1depth_name, municipality: address.region_2depth_name || '',
    district: address.region_3depth_name || '', address: site.matchedAddress, latitude: site.latitude, longitude: site.longitude };
}

export function recommendPlans(registry, admin, year) {
  if (!/^\d{10}$/.test(admin?.code || '')) throw new Error('행정코드를 확인해 주세요.');
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('계획 검토연도는 2000~2100년으로 입력해 주세요.');
  return registry.plans.map(plan => {
    const { coverage } = plan;
    const match = coverage.prefixes.some(prefix => admin.code.startsWith(prefix));
    let relevance = 'other';
    let reason = '등록 자료를 직접 검토하여 추가할 수 있습니다. 주소와의 관련성이 확인되지 않았습니다.';
    if (coverage.kind === 'national') { relevance = 'national'; reason = '전국을 대상으로 하는 상위계획입니다. 개별 사업 반영 여부는 별도 검토합니다.'; }
    else if (match && coverage.kind !== 'unresolved') {
      relevance = coverage.kind === 'metropolitan' ? 'metropolitan' : 'direct';
      reason = `${admin.province} ${admin.municipality} 주소가 원문에 명시된 계획 적용 범위에 포함됩니다.`;
    } else if (['P31', 'A14'].includes(plan.planId) && CAPITAL.includes(admin.code.slice(0,2))) {
      relevance = 'metropolitan'; reason = '원문에 명시된 수도권 연계·영향권입니다. 해당 노선의 근접성은 확인하지 않았습니다.';
    } else if (coverage.kind === 'unresolved' && (!coverage.prefixes.length || match)) {
      relevance = 'review'; reason = '행정구역만으로 해당 광역권·특정 구역 포함 여부를 확정할 수 없습니다.';
    } else if (['P32', 'P34'].includes(plan.planId) && CAPITAL.includes(admin.code.slice(0,2))) {
      relevance = 'review'; reason = '수도권 일부가 간접 범위이나 인접성·개별 교통권역은 추가 확인이 필요합니다.';
    }
    const [start, end] = plan.period;
    const periodStatus = end && year > end ? '기간 경과 · 후속본 확인 필요' : start && year < start ? '계획기간 이전'
      : start && end ? '계획기간 내' : end ? '목표연도 기준 · 시작연도 미확인' : '기간 확인 필요';
    // The research snapshot cannot establish which edition was effective in a
    // historical year. Do not silently use today's edition as historical law.
    const historical = year < Number(registry.registryVersion.slice(0,4));
    const autoSelected = ['direct', 'metropolitan', 'national'].includes(relevance) && plan.status === '적용'
      && !(end && year > end) && !(start && year < start) && !historical;
    const { summary, ...metadata } = plan;
    return { ...metadata, sources: plan.sources.map(({ url, kind }) => ({ url, kind })),
      hasSummary: !!summary, summaryFileName: summary?.fileName || '',
      relevance, relevanceLabel: LABELS[relevance], reason, autoSelected, periodStatus,
      yearNote: historical ? '과거 검토연도의 유효 버전은 별도 대조가 필요하여 자동 선택하지 않았습니다.' : '',
    };
  }).sort((a,b) => ['direct','metropolitan','national','review','other'].indexOf(a.relevance) - ['direct','metropolitan','national','review','other'].indexOf(b.relevance)
    || a.planId.localeCompare(b.planId));
}
