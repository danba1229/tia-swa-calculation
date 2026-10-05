import { NextResponse } from 'next/server';
import { surveyTaas } from '../../../../lib/taasSurvey';
import { validateAccidentQuery } from '../../../../lib/accidentSurvey';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ message: '동일 사이트에서 요청해 주세요.' }, { status: 403 });
  let query;
  try { query = validateAccidentQuery(await request.json()); }
  catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 400 }); }
  try { return NextResponse.json({ success: true, ...await surveyTaas(query) }); }
  catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 503 }); }
}
