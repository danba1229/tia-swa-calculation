import { NextResponse } from 'next/server';
import { surveyKoroad } from '../../../../lib/koroad';
import { validateAccidentQuery } from '../../../../lib/accidentSurvey';
export const runtime = 'nodejs';
export const maxDuration = 90;
export async function POST(request) {
  let query;
  try { query = validateAccidentQuery(await request.json()); }
  catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 400 }); }
  try { return NextResponse.json({ success: true, ...await surveyKoroad(query) }); }
  catch (e) { return NextResponse.json({ success: false, message: e.message }, { status: 503 }); }
}
