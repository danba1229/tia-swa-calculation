import { NextResponse } from 'next/server';
import { surveyTaas } from '../../../../lib/taasSurvey';
import { validateAccidentQuery } from '../../../../lib/accidentSurvey';
import { guardedAccidentSurvey } from '../../../../lib/accidentGuard';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ message: '동일 사이트에서 요청해 주세요.' }, { status: 403 });
  let query;
  try { query = validateAccidentQuery(await request.json()); }
  catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 400 }); }
  try { return NextResponse.json({ success: true, ...await guardedAccidentSurvey(request, 'radius', query, surveyTaas) }); }
  catch (e) { return NextResponse.json({ success: false, message: e.status ? e.message : '사고조사에 실패했습니다. 저장소 또는 원자료 연결을 확인해 주세요.' }, { status: e.status || 503, headers: { 'Retry-After': String(e.retryAfter || 30) } }); }
}
