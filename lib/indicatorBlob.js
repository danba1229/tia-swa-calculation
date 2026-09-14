import crypto from "node:crypto";
import { get, head, list, put } from "@vercel/blob";
import { usernameHash } from "./indicatorAuth";

const ACCESS = "private";
const ROOT = "tia-indicator-v1";

async function streamText(stream) {
  return new Response(stream).text();
}

async function readJson(pathname) {
  const result = await get(pathname, { access: ACCESS });
  if (!result || result.statusCode !== 200) return null;
  const text = await streamText(result.stream);
  const metadata = await head(pathname);
  return {
    value: JSON.parse(text),
    etag: metadata.etag,
    pathname: result.blob.pathname,
  };
}

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

export function userPath(username) {
  return `${ROOT}/users/${usernameHash(username)}.json`;
}

export async function createUser(record) {
  const pathname = userPath(record.username);
  await put(pathname, JSON.stringify(record), {
    access: ACCESS,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return record;
}

export async function findUser(username) {
  return (await readJson(userPath(username)))?.value || null;
}

function projectPath(userId, projectId) {
  return `${ROOT}/projects/${userId}/${projectId}.json`;
}

function deterministicProjectId(userId, operationId) {
  const hex = crypto.createHash("sha256").update(`${userId}:${operationId}`, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function listProjects(userId) {
  const blobs = await listAll(`${ROOT}/projects/${userId}/`);
  const projects = [];
  for (const blob of blobs) {
    const item = await readJson(blob.pathname);
    if (!item || item.value.ownerUserId !== userId) continue;
    projects.push({
      projectId: item.value.projectId,
      name: item.value.name,
      address: item.value.calculation?.input?.address,
      targetYear: item.value.calculation?.input?.target_year,
      calculationZone: item.value.calculation?.calculation_zone,
      updatedAt: item.value.updatedAt,
      revision: item.etag,
      revisionNumber: item.value.revisionNumber,
    });
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProject(userId, projectId) {
  if (!/^[0-9a-f-]{36}$/.test(String(projectId || ""))) return null;
  const item = await readJson(projectPath(userId, projectId));
  if (!item || item.value.ownerUserId !== userId) return null;
  return { ...item.value, revision: item.etag };
}

export async function saveProject(user, request) {
  const now = new Date().toISOString();
  const operationId = String(request.operationId || "");
  if (!/^[0-9a-f-]{36}$/.test(operationId)) throw new Error("저장 요청 식별자가 올바르지 않습니다.");
  const name = String(request.name || "").trim().slice(0, 100);
  if (!name) throw new Error("사업명을 입력해 주세요.");
  const calculation = request.calculation;
  if (!calculation || typeof calculation !== "object") throw new Error("저장할 계산 결과가 없습니다.");

  const requestedProjectId = String(request.projectId || "");
  // A retry made before the first response arrives must address the same blob.
  // User ID prevents identical operation IDs from colliding across users.
  const projectId = requestedProjectId || deterministicProjectId(user.userId, operationId);
  if (!/^[0-9a-f-]{36}$/.test(projectId)) throw new Error("프로젝트 식별자가 올바르지 않습니다.");
  const pathname = projectPath(user.userId, projectId);
  const existing = await readJson(pathname);
  if (existing && existing.value.ownerUserId !== user.userId) throw new Error("이 작업에 접근할 권한이 없습니다.");
  if (existing?.value.lastOperationId === operationId) return { ...existing.value, revision: existing.etag, idempotentReplay: true };
  const baseRevision = String(request.baseRevision || "");
  if (existing && baseRevision !== existing.etag) {
    const error = new Error("다른 탭이나 세션에서 먼저 저장했습니다. 최신 작업을 다시 불러온 뒤 저장해 주세요.");
    error.code = "REVISION_CONFLICT";
    throw error;
  }
  if (!existing && baseRevision) {
    const error = new Error("새 작업에는 이전 리비전을 사용할 수 없습니다.");
    error.code = "REVISION_CONFLICT";
    throw error;
  }

  const document = {
    schemaVersion: 1,
    projectId,
    ownerUserId: user.userId,
    ownerUsername: user.username,
    name,
    createdAt: existing?.value.createdAt || now,
    updatedAt: now,
    revisionNumber: Number(existing?.value.revisionNumber || 0) + 1,
    lastOperationId: operationId,
    calculation,
  };
  const options = {
    access: ACCESS,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: Boolean(existing),
  };
  if (existing) options.ifMatch = existing.etag;
  try {
    const stored = await put(pathname, JSON.stringify(document), options);
    // `put` response fields vary by Blob SDK version. The private `get`
    // metadata is the authority for optimistic-concurrency ETag.
    const persisted = await readJson(stored.pathname || pathname);
    if (!persisted?.etag) throw new Error("저장 리비전을 확인할 수 없습니다.");
    return { ...document, revision: persisted.etag, idempotentReplay: false };
  } catch (error) {
    if (String(error?.name || "").includes("Precondition") || Number(error?.status) === 412) {
      const conflict = new Error("저장 중 다른 변경이 확인되었습니다. 최신 작업을 다시 불러와 주세요.");
      conflict.code = "REVISION_CONFLICT";
      conflict.storageStage = "conditional_blob_put";
      throw conflict;
    }
    error.storageStage = "blob_put_or_persisted_read";
    throw error;
  }
}
