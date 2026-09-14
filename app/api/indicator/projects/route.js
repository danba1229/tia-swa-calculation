import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { assertSameOrigin, readSession } from "../../../../lib/indicatorAuth";
import { getProject, listProjects, saveProject } from "../../../../lib/indicatorBlob";
import { verifyAndDecodeCalculationEnvelope } from "../../../../lib/indicatorResult";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ success: false, error: "로그인이 필요합니다." }, { status: 401 });
}

function trace(value) {
  return value ? crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 12) : null;
}

function storageFailureLog(error, context) {
  // Deliberately omit address, calculation payload, username, cookie, provider
  // response body, Blob URL and every environment variable.
  console.error(JSON.stringify({
    event: "indicator_project_storage_failure",
    at: new Date().toISOString(),
    action: context.action,
    userTrace: trace(context.userId),
    projectTrace: trace(context.projectId),
    operationTrace: trace(context.operationId),
    storageStage: error.storageStage || context.storageStage || "unknown",
    errorCode: error.code || "SAVE_ERROR",
    errorClass: error.name || "Error",
    status: Number(error.status || 0) || null,
  }));
}

export async function GET(request) {
  let audit = { action: "read", storageStage: "authenticate" };
  try {
    const user = readSession(request);
    if (!user) return unauthorized();
    audit.userId = user.userId;
    const projectId = new URL(request.url).searchParams.get("id");
    audit.projectId = projectId;
    audit.storageStage = projectId ? "get_project" : "list_projects";
    if (projectId) {
      const project = await getProject(user.userId, projectId);
      return project
        ? NextResponse.json({ success: true, project })
        : NextResponse.json({ success: false, error: "저장 작업을 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ success: true, projects: await listProjects(user.userId) });
  } catch (error) {
    storageFailureLog(error, audit);
    return NextResponse.json({ success: false, error: "작업 조회 중 저장소 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request) {
  let audit = { action: "save", storageStage: "authenticate" };
  try {
    assertSameOrigin(request);
    const user = readSession(request);
    if (!user) return unauthorized();
    audit.userId = user.userId;
    const body = await request.json();
    audit.operationId = body.operationId;
    audit.projectId = body.projectId;
    audit.storageStage = "verify_calculation";
    const calculation = verifyAndDecodeCalculationEnvelope(body.calculationEnvelope);
    audit.storageStage = "save_project";
    const project = await saveProject(user, { ...body, calculation });
    return NextResponse.json({ success: true, project });
  } catch (error) {
    storageFailureLog(error, audit);
    const status = error.code === "REVISION_CONFLICT" ? 409 : 400;
    const publicError = error.code === "REVISION_CONFLICT"
      ? error.message
      : audit.storageStage === "save_project"
        ? "작업 저장 중 저장소 오류가 발생했습니다. 같은 저장 요청을 다시 시도할 수 있습니다."
        : error.message || "작업 저장 실패";
    return NextResponse.json({ success: false, error: publicError, errorCode: error.code || "SAVE_ERROR" }, { status });
  }
}
