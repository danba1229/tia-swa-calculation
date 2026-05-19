import { NextResponse } from "next/server";
import { geocodeAddress } from "../../../lib/kakao";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await geocodeAddress(body?.address);

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[geocode]", error);
    return NextResponse.json(
      { success: false, message: error.message || "카카오 API 호출 실패" },
      { status: 500 },
    );
  }
}
