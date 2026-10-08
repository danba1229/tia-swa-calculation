import { NextResponse } from 'next/server';
import { querySeoulSigns } from '../../../lib/server/seoulSigns';
import { signScope } from '../../../lib/trafficSigns';

export const runtime = 'nodejs';
export async function GET(request) {
  const input = Object.fromEntries(new URL(request.url).searchParams);
  try { signScope(input); } catch (error) { return NextResponse.json({ message: error.message }, { status: 400 }); }
  try {
    return NextResponse.json(await querySeoulSigns(input), { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch (error) {
    if (error.message.includes('범위를 줄여')) return NextResponse.json({ message: error.message }, { status: 422 });
    console.error('Seoul sign snapshot unavailable:', error.message);
    return NextResponse.json({ message: '서울 표지판 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 });
  }
}
