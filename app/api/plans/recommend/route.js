import registry from '../../../../data/plans/registry.json';
import { geocodeAddress } from '../../../../lib/kakao';
import { planAdminFromGeocode, recommendPlans } from '../../../../lib/planRecommendations';

export const runtime = 'nodejs';
export async function POST(request) {
  try {
    if (Number(request.headers.get('content-length')) > 4096) return Response.json({ error: '요청이 너무 큽니다.' }, { status: 413 });
    const text = await request.text();
    if (text.length > 4096) return Response.json({ error: '요청이 너무 큽니다.' }, { status: 413 });
    const body = JSON.parse(text);
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    const year = Number(body.year);
    if (!address || address.length > 250 || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return Response.json({ error: '주소와 계획 검토연도(2000~2100)를 확인해 주세요.' }, { status: 400 });
    }
    const site = await geocodeAddress(address);
    if (!site.success) return Response.json({ error: site.message || '주소 확인 실패' }, { status: 422 });
    const admin = planAdminFromGeocode(site);
    return Response.json({ registryVersion: registry.registryVersion, researchCount: registry.researchCount,
      summaryCount: registry.summaryCount, admin, year, plans: recommendPlans(registry, admin, year) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: '행정구역과 계획 자료를 확인하지 못했습니다. 상세 주소로 다시 시도해 주세요.' }, { status: 422 });
  }
}
