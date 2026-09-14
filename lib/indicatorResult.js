import crypto from "node:crypto";

function secret() {
  const value = String(process.env.TIA_CALCULATOR_SESSION_SECRET || "");
  if (value.length < 32) throw new Error("계산 결과 검증 설정이 준비되지 않았습니다.");
  return value;
}

export function verifyAndDecodeCalculationEnvelope(envelope) {
  const parts = String(envelope || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("계산 결과 서명이 없습니다. 다시 계산해 주세요.");
  const [, encoded, suppliedText] = parts;
  const expectedText = crypto.createHmac("sha256", secret()).update(encoded, "ascii").digest("base64url");
  const supplied = Buffer.from(suppliedText, "ascii");
  const expected = Buffer.from(expectedText, "ascii");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error("계산 결과가 변경되었거나 다른 배포 자료와 섞였습니다. 다시 계산해 주세요.");
  }
  let calculation;
  try {
    calculation = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("계산 결과를 읽을 수 없습니다. 다시 계산해 주세요.");
  }
  if (!calculation || typeof calculation !== "object" || !calculation.integrity_token) {
    throw new Error("저장할 계산 결과가 올바르지 않습니다.");
  }
  calculation.storage_envelope = envelope;
  return calculation;
}
