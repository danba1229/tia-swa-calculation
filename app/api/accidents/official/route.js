import { NextResponse } from 'next/server';
import { surveyKoroad } from '../../../../lib/koroad';
import { validateAccidentQuery } from '../../../../lib/accidentSurvey';
import { guardedAccidentSurvey } from '../../../../lib/accidentGuard';
export const runtime = 'nodejs';
export const maxDuration = 90;
export async function POST(request) {
  let query;
  try { query = validateAccidentQuery(await request.json()); }
  catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 400 }); }
  try { return NextResponse.json({ success: true, ...await guardedAccidentSurvey(request, 'official', query, surveyKoroad) }); }
  catch (e) { return NextResponse.json({ success: false, message: e.status ? e.message : '사고조사에 실패했습니다. 저장소 또는 원자료 연결을 확인해 주세요.' }, { status: e.status || 503, headers: { 'Retry-After': String(e.retryAfter || 30) } }); }
}
