import { neon } from "@neondatabase/serverless";
import { matchesAdminCriteria, matchesProjectType, matchesYear, normalizeProject } from "./tiaApi.js";

let cachedSql = null;
let schemaReady = false;

function databaseUrl() {
  return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").replace(/^["']|["']$/g, "").trim();
}

export function isTiaDatabaseConfigured() {
  return Boolean(databaseUrl());
}

function getSql() {
  const url = databaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }
  if (!cachedSql) cachedSql = neon(url);
  return cachedSql;
}

export async function ensureTiaSchema() {
  if (schemaReady) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS tia_projects (
      project_key TEXT PRIMARY KEY,
      bsns_no TEXT,
      project_name TEXT NOT NULL,
      location TEXT,
      project_type TEXT,
      facility_type TEXT,
      project_period TEXT,
      site_area TEXT,
      gross_floor_area TEXT,
      household_count TEXT,
      developer TEXT,
      review_result TEXT,
      registered_date TEXT,
      registered_year INTEGER,
      source TEXT,
      search_text TEXT,
      raw_data JSONB,
      first_seen_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tia_projects_registered_year ON tia_projects (registered_year)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tia_projects_bsns_no ON tia_projects (bsns_no)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tia_projects_search_text ON tia_projects USING gin (to_tsvector('simple', COALESCE(search_text, '')))`;
  await sql`
    CREATE TABLE IF NOT EXISTS tia_sync_periods (
      period_key TEXT PRIMARY KEY,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL,
      total_count INTEGER,
      requested_pages INTEGER,
      synced_count INTEGER DEFAULT 0,
      complete BOOLEAN DEFAULT FALSE,
      error TEXT,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  schemaReady = true;
}

function projectKey(project) {
  return [
    project.id,
    project.projectName,
    project.location,
  ].filter(Boolean).join("|") || `${project.source}-${Date.now()}-${Math.random()}`;
}

function registeredYear(project) {
  const match = String(project.registeredDate || project.projectPeriod || "").match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

function searchText(project) {
  return [
    project.projectName,
    project.location,
    project.projectType,
    project.facilityType,
    project.projectPeriod,
    project.developer,
    project.reviewResult,
    typeof project.raw === "object" ? JSON.stringify(project.raw) : project.raw,
  ].filter(Boolean).join(" ");
}

export async function upsertTiaProjects(projects = []) {
  await ensureTiaSchema();
  const sql = getSql();
  let count = 0;

  for (const project of projects) {
    const key = projectKey(project);
    await sql`
      INSERT INTO tia_projects (
        project_key, bsns_no, project_name, location, project_type, facility_type,
        project_period, site_area, gross_floor_area, household_count, developer,
        review_result, registered_date, registered_year, source, search_text, raw_data, updated_at
      )
      VALUES (
        ${key}, ${project.id || ""}, ${project.projectName || ""}, ${project.location || ""},
        ${project.projectType || ""}, ${project.facilityType || ""}, ${project.projectPeriod || ""},
        ${project.siteArea || ""}, ${project.grossFloorArea || ""}, ${project.householdCount || ""},
        ${project.developer || ""}, ${project.reviewResult || ""}, ${project.registeredDate || ""},
        ${registeredYear(project)}, ${project.source || "TIA_SYSTEM_API"}, ${searchText(project)},
        ${JSON.stringify(project.raw || {})}::jsonb, NOW()
      )
      ON CONFLICT (project_key) DO UPDATE SET
        bsns_no = EXCLUDED.bsns_no,
        project_name = EXCLUDED.project_name,
        location = EXCLUDED.location,
        project_type = EXCLUDED.project_type,
        facility_type = EXCLUDED.facility_type,
        project_period = EXCLUDED.project_period,
        site_area = EXCLUDED.site_area,
        gross_floor_area = EXCLUDED.gross_floor_area,
        household_count = EXCLUDED.household_count,
        developer = EXCLUDED.developer,
        review_result = EXCLUDED.review_result,
        registered_date = EXCLUDED.registered_date,
        registered_year = EXCLUDED.registered_year,
        source = EXCLUDED.source,
        search_text = EXCLUDED.search_text,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW()
    `;
    count += 1;
  }

  return count;
}

export async function saveTiaSyncPeriod(summary) {
  await ensureTiaSchema();
  const sql = getSql();
  const periodKey = `${summary.startDate}_${summary.endDate}`;
  await sql`
    INSERT INTO tia_sync_periods (
      period_key, start_date, end_date, status, total_count,
      requested_pages, synced_count, complete, error, synced_at
    )
    VALUES (
      ${periodKey}, ${summary.startDate}, ${summary.endDate}, ${summary.status},
      ${summary.totalCount ?? null}, ${summary.requestedPages ?? null},
      ${summary.syncedCount ?? 0}, ${Boolean(summary.complete)}, ${summary.error || ""}, NOW()
    )
    ON CONFLICT (period_key) DO UPDATE SET
      status = EXCLUDED.status,
      total_count = EXCLUDED.total_count,
      requested_pages = EXCLUDED.requested_pages,
      synced_count = EXCLUDED.synced_count,
      complete = EXCLUDED.complete,
      error = EXCLUDED.error,
      synced_at = NOW()
  `;
}

export async function searchStoredTiaProjects(criteria = {}) {
  if (!isTiaDatabaseConfigured()) return [];
  await ensureTiaSchema();
  const sql = getSql();
  const startYear = Number(criteria.startYear) || null;
  const endYear = Number(criteria.endYear) || null;
  const sigungu = String(criteria.sigungu || "").trim();
  const rows = await sql`
    SELECT *
    FROM tia_projects
    WHERE (${startYear}::integer IS NULL OR registered_year IS NULL OR registered_year >= ${startYear})
      AND (${endYear}::integer IS NULL OR registered_year IS NULL OR registered_year <= ${endYear})
      AND (${sigungu} = '' OR search_text ILIKE ${`%${sigungu}%`})
    ORDER BY registered_date DESC NULLS LAST, updated_at DESC
    LIMIT 1000
  `;

  return rows
    .map((row, index) => normalizeProject({
      사업명: row.project_name,
      사업위치: row.location,
      사업구분: row.project_type,
      용도: row.facility_type,
      사업기간: row.project_period,
      사업면적: row.site_area,
      연면적: row.gross_floor_area,
      세대수: row.household_count,
      사업시행자: row.developer,
      심의결과: row.review_result,
      등록일: row.registered_date,
      사업번호: row.bsns_no || row.project_key,
      ...(row.raw_data || {}),
    }, index, "TIA_DB"))
    .filter((project) => (
      matchesAdminCriteria(project, criteria.sido, criteria.sigungu)
      && matchesYear(project, criteria.startYear, criteria.endYear)
      && matchesProjectType(project, criteria.projectType)
    ));
}
