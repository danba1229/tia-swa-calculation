import crypto from "node:crypto";

export const CALCULATOR_COOKIE = "tia_indicator_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function sessionSecret() {
  const value = String(process.env.TIA_CALCULATOR_SESSION_SECRET || "").trim();
  if (value.length < 32) throw new Error("TIA_CALCULATOR_SESSION_SECRET is not configured");
  return value;
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

export function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9가-힣][a-z0-9가-힣._@-]{2,39}$/.test(username)) {
    throw new Error("사용자 이름은 3~40자의 한글·영문·숫자와 . _ @ - 만 사용할 수 있습니다.");
  }
  return username;
}

export function usernameHash(username) {
  return crypto.createHash("sha256").update(normalizeUsername(username)).digest("hex");
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const value = String(password || "");
  if (value.length < 10 || value.length > 200) throw new Error("비밀번호는 10자 이상이어야 합니다.");
  const digest = crypto.pbkdf2Sync(value, salt, 210000, 32, "sha256").toString("base64url");
  return { algorithm: "pbkdf2-sha256", iterations: 210000, salt, digest };
}

export function verifyPassword(password, record) {
  if (!record || record.algorithm !== "pbkdf2-sha256" || record.iterations !== 210000) return false;
  const actual = crypto.pbkdf2Sync(String(password || ""), record.salt, record.iterations, 32, "sha256");
  const expected = Buffer.from(record.digest, "base64url");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function verifyInviteCode(value) {
  const expected = Buffer.from(String(process.env.TIA_CALCULATOR_INVITE_CODE || ""));
  const supplied = Buffer.from(String(value || ""));
  return expected.length >= 16 && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

export function createSession(user) {
  const payload = {
    v: 1,
    sub: user.userId,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };
  const encoded = encode(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function readSession(request) {
  const raw = request.cookies.get(CALCULATOR_COOKIE)?.value || "";
  try {
    const [encoded, supplied] = raw.split(".");
    const expected = crypto.createHmac("sha256", sessionSecret()).update(encoded).digest();
    const actual = Buffer.from(supplied, "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.v !== 1 || !payload.sub || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

export function setSessionCookie(response, user) {
  response.cookies.set(CALCULATOR_COOKIE, createSession(user), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return response;
}

export function clearSessionCookie(response) {
  response.cookies.set(CALCULATOR_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (new URL(request.url).origin !== origin) throw new Error("요청 출처를 확인할 수 없습니다.");
}
