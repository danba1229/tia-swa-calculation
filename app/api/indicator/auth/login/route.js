import { NextResponse } from "next/server";
import { assertSameOrigin, normalizeUsername, setSessionCookie, verifyPassword } from "../../../../../lib/indicatorAuth";
import { findUser } from "../../../../../lib/indicatorBlob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    const username = normalizeUsername(body.username);
    const user = await findUser(username);
    if (!user || user.status !== "ACTIVE" || !verifyPassword(body.password, user.password)) {
      return NextResponse.json({ success: false, error: "사용자 이름 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }
    const response = NextResponse.json({ success: true, user: { userId: user.userId, username: user.username } });
    return setSessionCookie(response, user);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "로그인 실패" }, { status: 400 });
  }
}
