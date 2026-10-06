import { NextResponse } from "next/server";
import { geocodeAddress, lookupKakaoAddress } from "../../../../lib/kakao";
import { geocodeProject } from "../../../../lib/projectGeocode";
import { fetchTiaProjects } from "../../../../lib/tiaApi";
import { isTiaDatabaseConfigured, searchStoredTiaProjects, hasCompleteTiaCoverage } from "../../../../lib/tiaDatabase";
import { mergeStoredAndLive } from "../../../../lib/tiaCoverage";
import { buildLocalNoticeSearches } from "../../../../lib/localNoticeSearch";
import { haversineDistanceMeters } from "../../../../lib/distance";
import { judgeReflection } from "../../../../lib/judgeReflection";
import { createHash } from "node:crypto";
import { isInsideScope, summarizeProjects } from "../../../../lib/tiaScope";

export const maxDuration = 60;
const snapshots = new Map();

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const radiusMeters = toNumber(body?.radiusMeters, 2000);
    const siteAddress = String(body?.siteAddress || "").trim();
    const width = toNumber(body?.width);
    const height = toNumber(body?.height);
    if ((body?.width !== undefined || body?.height !== undefined) && !(width >= 1 && height >= 1 && width <= 100000 && height <= 100000)) {
      return NextResponse.json({ success: false, message: "가로·세로 조사 범위는 1~100,000m로 입력해 주세요." }, { status: 400 });
    }
    const offset = Number(body?.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return NextResponse.json({ success: false, message: "잘못된 조회 위치입니다." }, { status: 400 });
    }

    if (!siteAddress) {
      return NextResponse.json({ success: false, message: "사업지 주소를 입력해 주세요." }, { status: 400 });
    }

    const siteGeocode = await geocodeAddress(siteAddress);
    if (!siteGeocode.success) {
      return NextResponse.json({ success: false, message: siteGeocode.message || "사업지 주소 좌표 변환 실패" }, { status: 400 });
    }

    const searchCriteria = {
      sido: body?.sido,
      sigungu: body?.sigungu,
      startYear: body?.startYear,
      endYear: body?.endYear,
      projectType: body?.projectType,
    };
    const dbConfigured = isTiaDatabaseConfigured();
    let storedProjects = [];
    let dbWarning = "";
    let coverageComplete = false;
    if (dbConfigured) {
      try {
        storedProjects = await searchStoredTiaProjects(searchCriteria);
        coverageComplete = await hasCompleteTiaCoverage(searchCriteria);
      } catch (error) {
        dbWarning = error.message || "DB 조회 실패";
        console.warn("[tia/search] DB fallback:", error);
      }
    }
    const cacheKey = JSON.stringify([searchCriteria, coverageComplete]);
    const cached = snapshots.get(cacheKey);
    let fallbackResponse;
    try {
      fallbackResponse = cached && cached.expiresAt > Date.now() ? cached.response
        : await fetchTiaProjects(searchCriteria, { excludeSources: coverageComplete ? ['TIA_SYSTEM_API'] : [] });
    } catch {
      if (!storedProjects.length) throw new Error('주변사업 원자료를 조회하지 못했습니다. 잠시 후 다시 조회해 주세요.');
      fallbackResponse = { rawCount: 0, projects: [], requestUrls: [], errors: ['실시간 보완조회 실패: 저장된 일부 후보만 표시합니다.'], sources: [], sourceCounts: {}, sourceDiagnostics: [] };
    }
    if (fallbackResponse && cached?.response !== fallbackResponse) {
      if (snapshots.size >= 20) snapshots.delete(snapshots.keys().next().value);
      snapshots.set(cacheKey, { response: fallbackResponse, expiresAt: Date.now() + 600000 });
    }
    const merged = mergeStoredAndLive(storedProjects, fallbackResponse.projects);
    const tiaResponse = { ...fallbackResponse, projects: merged, rawCount: merged.length,
      errors: [...fallbackResponse.errors, ...(dbWarning ? ['DB 자료 확인 실패'] : [])],
      sources: [...(storedProjects.length ? ['TIA_DB'] : []), ...fallbackResponse.sources],
      sourceCounts: { ...fallbackResponse.sourceCounts, TIA_DB: storedProjects.length } };
    const dataMode = storedProjects.length ? "DB_AND_LIVE" : "LIVE_API";
    const noticeSearches = buildLocalNoticeSearches(searchCriteria);
    const sourceWarnings = [...(tiaResponse.errors || [])];
    if (tiaResponse.sourceDiagnostics?.some((source) => source.pageInfo?.complete === false)) {
      sourceWarnings.push("공공 API의 전체 페이지를 수집하지 못했습니다. 수집된 후보에 한한 결과입니다.");
    }

    const datasetId = createHash("sha256").update(JSON.stringify(tiaResponse.projects)).digest("hex");
    if (body?.datasetId && body.datasetId !== datasetId) {
      return NextResponse.json({ success: false, message: "조회 중 후보 자료가 갱신되었습니다. 다시 검색해 주세요." }, { status: 409 });
    }
    const batchSize = 20;
    const geocodedProjects = [];
    const startedAt = Date.now();

    for (const project of tiaResponse.projects.slice(offset, offset + batchSize)) {
      const projectGeocode = await geocodeProject(project, {
        lookup: lookupKakaoAddress,
        budgetMs: Math.min(12000, Math.max(1, 20000 - (Date.now() - startedAt))),
      });
      if (["AUTH_ERROR", "MISSING_API_KEY", "RATE_LIMITED"].includes(projectGeocode.code)) {
        return NextResponse.json({ success: false, code: projectGeocode.code, message: projectGeocode.message }, { status: 503 });
      }
      const distanceMeters = projectGeocode.success
        ? haversineDistanceMeters(
          { latitude: siteGeocode.latitude, longitude: siteGeocode.longitude },
          { latitude: projectGeocode.latitude, longitude: projectGeocode.longitude },
        )
        : null;
      const partial = {
        ...project,
        longitude: projectGeocode.success ? projectGeocode.longitude : null,
        latitude: projectGeocode.success ? projectGeocode.latitude : null,
        matchedAddress: projectGeocode.success ? projectGeocode.matchedAddress : "",
        geocodeStatus: projectGeocode.success ? "success" : "failed",
        geocodeCode: projectGeocode.code,
        geocodeMessage: projectGeocode.message,
        geocodeQuery: projectGeocode.query || "",
        geocodeMethod: projectGeocode.method || "",
        geocodeAttempts: projectGeocode.attempts || [],
        geocodeAddressType: projectGeocode.addressType || "",
        distanceMeters,
        distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null,
      };
      partial.withinScope = isInsideScope(siteGeocode, partial, width, height, radiusMeters);
      const judgment = judgeReflection(partial, distanceMeters, radiusMeters);
      if (projectGeocode.success && !partial.withinScope) {
        judgment.reflectionStatus = "제외후보";
        judgment.reflectionReason = "설정한 조사 범위 밖에 위치합니다.";
      }
      geocodedProjects.push({ ...partial, ...judgment });
      if (Date.now() - startedAt >= 20000) break;
    }

    const sortedResults = geocodedProjects.sort((a, b) => {
      const aDistance = Number.isFinite(a.distanceMeters) ? a.distanceMeters : Number.MAX_SAFE_INTEGER;
      const bDistance = Number.isFinite(b.distanceMeters) ? b.distanceMeters : Number.MAX_SAFE_INTEGER;
      return aDistance - bDistance;
    });

    return NextResponse.json({
      success: true,
      site: {
        name: body?.siteName || "",
        address: siteAddress,
        longitude: siteGeocode.longitude,
        latitude: siteGeocode.latitude,
        matchedAddress: siteGeocode.matchedAddress,
      },
      summary: summarizeProjects(tiaResponse.rawCount, sortedResults),
      pagination: {
        datasetId,
        processedCount: offset + sortedResults.length,
        candidateCount: tiaResponse.projects.length,
        nextOffset: offset + sortedResults.length < tiaResponse.projects.length ? offset + sortedResults.length : null,
      },
      results: sortedResults,
      dataMode,
      dbConfigured,
      coverageComplete,
      noticeSearches,
      debug: {
        requestUrls: tiaResponse.requestUrls,
        apiSources: tiaResponse.sources,
        apiErrors: sourceWarnings,
        dbWarning,
        sourceCounts: tiaResponse.sourceCounts,
        sourceDiagnostics: body?.debug ? tiaResponse.sourceDiagnostics : undefined,
        normalizedCount: tiaResponse.projects.length,
        batchSize,
      },
    });
  } catch (error) {
    console.error("[tia/search]", error);
    return NextResponse.json(
      { success: false, message: error.message || "교통영향평가 API 호출 실패" },
      { status: 500 },
    );
  }
}
