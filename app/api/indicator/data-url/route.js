import crypto from "node:crypto";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import bundle from "../../../../calculator_core/cloud_data_bundle.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CLOCK_SKEW_SECONDS = 60;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function expectedSignature(timestamp, version) {
  const secret = process.env.TIA_CALCULATOR_SESSION_SECRET || "";
  if (secret.length < 32) throw new Error("SERVER_SECRET_MISSING");
  return crypto.createHmac("sha256", secret).update(`data-bundle:${version}:${timestamp}`, "utf8").digest("hex");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const timestamp = Number(body.timestamp);
    const version = String(body.version || "");
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
      return Response.json({ success: false, error: "요청 시간이 유효하지 않습니다." }, { status: 401 });
    }
    if (version !== bundle.version || !safeEqual(body.signature, expectedSignature(timestamp, version))) {
      return Response.json({ success: false, error: "계산자료 요청을 인증할 수 없습니다." }, { status: 401 });
    }

    const validUntil = Date.now() + 120_000;
    const signedToken = await issueSignedToken({
      pathname: bundle.blob_path,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      operation: "get",
      pathname: bundle.blob_path,
      access: "private",
      validUntil,
      useCache: true,
    });
    return Response.json({ success: true, presignedUrl, validUntil }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "indicator_data_url_failure",
      at: new Date().toISOString(),
      errorClass: error?.name || "Error",
    }));
    return Response.json({ success: false, error: "계산자료 접근을 준비하지 못했습니다." }, { status: 503 });
  }
}
