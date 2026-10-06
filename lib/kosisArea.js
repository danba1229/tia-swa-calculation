export function kosisAreaM2(row) {
  if (!row || row.DT == null || ['', '-'].includes(String(row.DT).trim())) return null;
  const value = Number(String(row.DT).replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0) throw new Error('KOSIS 면적 숫자를 확인할 수 없습니다.');
  let unit = String(row.UNIT_NM || '').replace(/\s/g, '').toLowerCase();
  // This table combines area and parcel-count units; only its area item is m2.
  if (unit === '㎡필지' && row.ITM_ID === '13103874596T1' && /^면적(?:\(㎡\))?$/.test(String(row.ITM_NM || '').replace(/\s/g, ''))) unit = '㎡';
  const units = { '㎡': 1, 'm²': 1, m2: 1, '제곱미터': 1, '천㎡': 1000, '천m²': 1000, '천m2': 1000,
    '천제곱미터': 1000, ha: 10000, '헥타르': 10000, '㎢': 1000000, 'km²': 1000000, km2: 1000000, '제곱킬로미터': 1000000 };
  if (!Object.hasOwn(units, unit)) throw new Error(`KOSIS 면적 단위 '${String(row.UNIT_NM || '(미제공)').slice(0, 60)}' (항목: ${String(row.ITM_NM || '').slice(0, 40)}, ${String(row.ITM_ID || '').slice(0, 40)})를 확인하지 못했습니다. 자동 확정을 보류합니다.`);
  return value * units[unit];
}

export function verifyKosisRows(rows, { year, regionCode, regionField }) {
  return rows.map(row => {
    if (String(row.PRD_DE) !== String(year)) throw new Error('KOSIS 응답 기준연도가 요청 연도와 다릅니다.');
    if (String(row[regionField]) !== String(regionCode)) throw new Error('KOSIS 응답 행정구역 코드가 요청과 다릅니다.');
    const converted = kosisAreaM2(row);
    return { ...row, conversion: { raw: row.DT, sourceUnit: row.UNIT_NM, m2: converted, km2: converted === null ? null : converted / 1000000 } };
  });
}
