import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { execFileSync } from "node:child_process";
import * as XLSX from "xlsx";

const GITS_OCCASIONAL_PAGE_URL = "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolume.do";
const GITS_ROUTE_CATALOG_URL = "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/getChangeLoadCate.do";
const GITS_OCCASIONAL_LOAD_URL = "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/occasionalTrafficVolumeLoad.do";
const OUTPUT_PATH = path.join(process.cwd(), "app", "gyeonggi-gits-points.json");
const CATEGORY_LABELS = {
  "1": "고속도로",
  "2": "일반국도",
  "3": "국가지원지방도",
  "4": "지방도",
  "5": "시군도",
};

function safe(value) {
  return String(value ?? "").trim();
}

function normalizePointCode(value) {
  return safe(value).replace(/\.0$/, "");
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function fetchLatestYear() {
  const response = await fetch(GITS_OCCASIONAL_PAGE_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!response.ok) {
    throw new Error(`Failed to load GITS occasional traffic page: ${response.status}`);
  }

  const html = await response.text();
  const years = Array.from(html.matchAll(/<option value ="?(\d{4})"?/g)).map((match) => Number(match[1]));
  const latestYear = years.filter(Number.isFinite).sort((a, b) => b - a)[0];
  return latestYear ? String(latestYear) : "2024";
}

async function fetchRouteCatalog() {
  const routes = [];

  for (const [category, categoryLabel] of Object.entries(CATEGORY_LABELS)) {
    const response = await fetch(`${GITS_ROUTE_CATALOG_URL}?admin=${encodeURIComponent(category)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
        Referer: GITS_OCCASIONAL_PAGE_URL,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load route catalog for category ${category}: ${response.status}`);
    }

    const rows = await response.json();
    rows.forEach((row) => {
      routes.push({
        code: safe(row.no_line),
        name: safe(row.name_line),
        category,
        categoryLabel,
      });
    });
  }

  return routes;
}

async function fetchPointsForChunk(category, year, routes) {
  const params = new URLSearchParams();
  params.set("year1", year);
  params.set("roadcate", category);
  routes.forEach((route) => params.append("lineLocal01", route.code));
  params.set("direction", "0");
  params.set("T_Start", "07");
  params.set("T_End", "09");
  params.set("mode", "Excel");
  params.set("excelTitle", "OccasionalTrafficVolume");
  params.set("excelCaption", "19#연도, 지점번호, 호선명, 방향, 시간대, 행정구역, 구간명, 1종 ~ 12종, 전차종합계로 구성되어 있음");
  params.set("excelLabelTop", "");
  params.set("excelLabel", "연도,지점번호,노선명,방향,시간대,행정구역,구간명,1종,2종,3종,4종,5종,6종,7종,8종,9종,10종,11종,12종,전차종합계");

  const tempFile = path.join(
    os.tmpdir(),
    `gyeonggi-gits-${category}-${routes.map((route) => route.code).join("_").replace(/[^\w.-]/g, "_")}.xlsx`,
  );
  const body = params.toString().replace(/\+/g, "%20").replace(/'/g, "''");
  const escapedTempFile = tempFile.replace(/'/g, "''");
  const escapedUri = GITS_OCCASIONAL_LOAD_URL.replace(/'/g, "''");
  const escapedReferer = GITS_OCCASIONAL_PAGE_URL.replace(/'/g, "''");

  execFileSync(
    "powershell",
    [
      "-Command",
      `$body='${body}'; Invoke-WebRequest -UseBasicParsing -Method Post -Uri '${escapedUri}' -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' -Headers @{'User-Agent'='Mozilla/5.0';'Referer'='${escapedReferer}'} -Body $body -OutFile '${escapedTempFile}'`,
    ],
    { stdio: "pipe" },
  );

  const buffer = await fs.readFile(tempFile);
  if (buffer.subarray(0, 2).toString("utf8") !== "PK") {
    console.warn(
      `Skipping non-xlsx response for category ${category}: ${routes.map((route) => `${route.code}:${route.name}`).join(", ")}`,
    );
    return [];
  }
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: "",
  });

  const routeMap = new Map(routes.map((route) => [route.name, route]));
  const points = [];

  rows.slice(2).forEach((row) => {
    const pointCode = normalizePointCode(row[1]);
    const routeName = safe(row[2]);
    const jurisdiction = safe(row[5]);
    const sectionName = safe(row[6]);
    const route = routeMap.get(routeName);

    if (!pointCode || !routeName || !sectionName || !route) return;

    points.push({
      pointCode,
      routeName,
      routeCode: route.code,
      jurisdiction: jurisdiction || "-",
      sectionName,
      category,
      categoryLabel: CATEGORY_LABELS[category],
    });
  });

  return points;
}

async function main() {
  const year = await fetchLatestYear();
  const routes = await fetchRouteCatalog();
  const points = [];
  const seen = new Set();

  for (const [category] of Object.entries(CATEGORY_LABELS)) {
    const categoryRoutes = routes.filter((route) => route.category === category);
    const groups = chunk(categoryRoutes, 3);

    for (const group of groups) {
      const chunkPoints = await fetchPointsForChunk(category, year, group);
      chunkPoints.forEach((point) => {
        const key = `${point.routeCode}:${point.pointCode}`;
        if (seen.has(key)) return;
        seen.add(key);
        points.push(point);
      });
    }
  }

  points.sort(
    (a, b) =>
      a.routeName.localeCompare(b.routeName, "ko") ||
      a.pointCode.localeCompare(b.pointCode, "ko"),
  );

  const payload = {
    source: "경기도교통정보시스템 수시교통량",
    sourceLink: GITS_OCCASIONAL_PAGE_URL,
    fallbackLink: "https://gits.gg.go.kr/gtdb/web/trafficDb/trafficVolume/regularAverageTrafficVolumeByWeekday.do",
    year,
    routes,
    points,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Saved ${points.length} GITS points (${year}) to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
