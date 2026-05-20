import { NextResponse } from "next/server";
import { geocodeAddress } from "../../../../lib/kakao";
import { fetchTiaProjects } from "../../../../lib/tiaApi";
import { haversineDistanceMeters } from "../../../../lib/distance";
import { judgeReflection } from "../../../../lib/judgeReflection";

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function summarize(totalRawCount, results, radiusMeters) {
  const withinRadius = results.filter((result) => Number.isFinite(result.distanceMeters) && result.distanceMeters <= radiusMeters);
  return {
    totalRawCount,
    geocodedCount: results.filter((result) => result.geocodeStatus === "success").length,
    withinRadiusCount: withinRadius.length,
    reflectCount: results.filter((result) => result.reflectionStatus === "반영").length,
    reviewCount: results.filter((result) => result.reflectionStatus === "반영검토").length,
    referenceCount: results.filter((result) => result.reflectionStatus === "참고").length,
    excludedCount: results.filter((result) => result.reflectionStatus === "제외후보").length,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const radiusMeters = toNumber(body?.radiusMeters, 2000);
    const siteAddress = String(body?.siteAddress || "").trim();

    if (!siteAddress) {
      return NextResponse.json({ success: false, message: "사업지 주소를 입력해 주세요." }, { status: 400 });
    }

    const siteGeocode = await geocodeAddress(siteAddress);
    if (!siteGeocode.success) {
      return NextResponse.json({ success: false, message: siteGeocode.message || "사업지 주소 좌표 변환 실패" }, { status: 400 });
    }

    const tiaResponse = await fetchTiaProjects({
      sido: body?.sido,
      sigungu: body?.sigungu,
      startYear: body?.startYear,
      endYear: body?.endYear,
      projectType: body?.projectType,
    });

    const geocodeLimit = 80;
    const geocodedProjects = [];

    for (const project of tiaResponse.projects.slice(0, geocodeLimit)) {
      const projectGeocode = project.location ? await geocodeAddress(project.location) : { success: false, message: "위치 정보 없음" };
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
        distanceMeters,
        distanceKm: Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null,
      };
      const judgment = judgeReflection(partial, distanceMeters, radiusMeters);
      geocodedProjects.push({ ...partial, ...judgment });
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
      summary: summarize(tiaResponse.rawCount, sortedResults, radiusMeters),
      results: sortedResults,
      debug: {
        requestUrls: tiaResponse.requestUrls,
        apiSources: tiaResponse.sources,
        apiErrors: tiaResponse.errors,
        normalizedCount: tiaResponse.projects.length,
        geocodeLimit,
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
