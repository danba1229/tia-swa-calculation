import { NextResponse } from 'next/server';
import { facilityScope } from '../../../lib/trafficFacilities';
import { queryTrafficFacilities } from '../../../lib/server/trafficFacilities';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request) {
  const input = Object.fromEntries(new URL(request.url).searchParams);
  try { facilityScope(input); } catch(e) { return NextResponse.json({message:e.message},{status:400}); }
  try { return NextResponse.json(await queryTrafficFacilities(input),{headers:{'Cache-Control':'no-store'}}); }
  catch(e) {
    const oversized = e.message.includes('범위를 줄여');
    return NextResponse.json({message:oversized?e.message:'교통시설물 자료를 불러오지 못했습니다. 다시 조회해 주세요.'},{status:oversized?422:503});
  }
}
