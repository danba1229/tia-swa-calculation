import { NextResponse } from 'next/server';
import { suggestAddresses } from '../../../lib/addressSuggestions';

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, suggestions: [], message: '검색어를 확인해 주세요.' }, { status: 400 }); }
  const { status, ...result } = await suggestAddresses(body?.query, { signal: request.signal });
  return NextResponse.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
}
