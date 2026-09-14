import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { assertSameOrigin, hashPassword, normalizeUsername, setSessionCookie, verifyInviteCode } from "../../../../../lib/indicatorAuth";
import { createUser, findUser } from "../../../../../lib/indicatorBlob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    if (!verifyInviteCode(body.inviteCode)) {
      return NextResponse.json({ success: false, error: "등록 승인 코드가 올바르지 않습니다." }, { status: 403 });
    }
    const username = normalizeUsername(body.username);
    if (await findUser(username)) {
      return NextResponse.json({ success: false, error: "이미 등록된 사용자입니다." }, { status: 409 });
    }
    const record = {
      schemaVersion: 1,
      userId: crypto.randomUUID(),
      username,
      password: hashPassword(body.password),
      createdAt: new Date().toISOString(),
      status: "ACTIVE",
    };
    await createUser(record);
    const response = NextResponse.json({ success: true, user: { userId: record.userId, username } });
    return setSessionCookie(response, record);
  } catch (error) {
    const conflict = String(error?.message || "").includes("already") || Number(error?.status) === 409;
    return NextResponse.json({ success: false, error: conflict ? "이미 등록된 사용자입니다." : (error.message || "사용자 등록 실패") }, { status: conflict ? 409 : 400 });
  }
}
