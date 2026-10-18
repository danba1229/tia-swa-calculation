import { selectSummary, summaryBlobPath, verifiedSummaryBytes, attachmentHeader, WORD_TYPE, PRIVATE_HEADERS } from './planDownload.js';

export function createPlanDownloadHandler({ registry, getBlob, log = console.error }) {
  return async function GET(request) {
    try {
      const plan = selectSummary(registry, new URL(request.url).searchParams.get('version'));
      const result = await getBlob(summaryBlobPath(plan), { access: 'private', useCache: true });
      if (!result || result.statusCode !== 200) throw new Error('SUMMARY_UNAVAILABLE');
      const bytes = await verifiedSummaryBytes(plan, result.stream);
      return new Response(bytes, { headers: { ...PRIVATE_HEADERS, 'Content-Type': WORD_TYPE,
        'Content-Disposition': attachmentHeader(plan.summary.fileName), 'Content-Length': String(bytes.length) } });
    } catch (error) {
      const missing = error.message === 'SUMMARY_NOT_FOUND';
      log(JSON.stringify({ event: 'plan_summary_download_failed', code: ['SUMMARY_NOT_FOUND','SUMMARY_UNAVAILABLE','HASH_MISMATCH','SIZE_MISMATCH'].includes(error.message) ? error.message : 'UNAVAILABLE' }));
      return Response.json({ error: missing ? '등록된 Word 요약본이 없습니다.' : '요약본 파일 연결 또는 무결성 확인에 실패했습니다. 관리자 확인이 필요합니다.' }, { status: missing ? 404 : 503, headers: PRIVATE_HEADERS });
    }
  };
}
