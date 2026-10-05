# Monthly traffic collection and weekly peak analysis

## Scope

Seoul TOPIS monthly point/date/direction/hour workbooks and Gyeonggi Data Dream
continuous general-national-road hourly OpenAPI records. This does not replace
intersection turning counts or determine statutory survey days automatically.

## Gyeonggi OpenAPI

- Server key: `GG_DATA_DREAM_API_KEY` (never `NEXT_PUBLIC_`).
- Endpoint: `https://openapi.gg.go.kr/ORDNTMTRNSPORTGENRLTM`.
- App route: `/api/traffic-volume/gyeonggi` for catalog, or query parameters
  `station`, `week` (ISO date), `direction` (`both`, `in`, `out`). Internally
  `in`/`out` identify source codes 1/2 only, NOT Seoul inflow/outflow semantics.
- `source=YYYY-MM` downloads preserved API rows as JSON with collection time
  and the SHA-256 of the full source snapshot, not a fabricated XLSX.
- Collects all pages sequentially (1,000 rows/page), checks total/page lengths,
  rechecks the first page, rejects duplicate station/date/direction keys, and
  only publishes a complete snapshot. Network/schema/auth errors expose no key.
- The Sheet labels TM01 as 00:00-01:00, through TM24 as 23:00-24:00.
- Source code 0 is inconsistently labelled as downbound but can contain the
  sum of codes 1 and 2. It remains in raw downloads and is NEVER added to
  analysis or used as a substitute for missing direction records.
- Missing values stay null. Daily-total mismatches invalidate the row's hours.
- Uses separate `gg_traffic_snapshot` / immutable `gg_traffic_versions` tables
  in the existing traffic database. The Seoul tables are not overwritten.
- First catalog request initializes/collects; subsequent requests reuse a
  24-hour snapshot. Refresh after expiry is demand-driven, NOT a newly added
  scheduled job. DB lease prevents multiple server instances collecting at once;
  a 2-minute cooldown follows failure. A stale snapshot is explicitly labelled.
- Gyeonggi points must be selected manually from the actual published catalog.
  The existing GITS occasional-survey candidates are not assumed equivalent,
  and unverified coordinates/distances are not shown as nearest-point evidence.
- Only actual observation months are offered. Portal metadata update dates do
  not become observation years. Live collection on 2026-10-05 returned 42,304
  rows, all for 2024; 14,283 code-0 rows excluded, 28,021 code-1/2 rows used.
- Local key currently lives in the original project `.env.local`; run the app
  with that key in its server environment. Vercel Production already has the
  Secret; new application code still requires an authorized deployment.

Tests: `node --test tests/gyeonggiTraffic.test.mjs tests/trafficPeak.test.mjs`.
Unit/live source verification does not establish deployed UI/DB operation.

## Cloud collection

`.github/workflows/traffic-volume.yml` runs every Monday around 07:23 KST.
The published unit is a month, not a week: one unchanged monthly workbook is
reused by every weekly query. Weekly checks allow delayed publication and source
corrections without repeatedly downloading unchanged files. No local PC required.
GitHub schedules may be delayed; execution is not guaranteed at an exact minute.

GitHub secret `TRAFFIC_DATABASE_URL` must point to the same Neon database as the
app's `TRAFFIC_DATABASE_URL` or `SEOUL_BUS_DATABASE_URL` (then DATABASE_URL fallback).
Secrets are never exposed to the client. No Vercel cron or application deployment
is needed for each data refresh. GitHub runner minutes and DB storage use the
account's shared allowance; there is no unlimited-free guarantee.

Manual backfill: run the workflow with `year`, or run on an authorized machine:

```powershell
node --env-file=.env.local scripts/sync_topis_monthly.mjs --year=2026
```

This downloads official files and writes only the `traffic_volume_*` tables.
Default scheduled checks cover the current and preceding calendar year. Older
years need an explicit backfill. Public monthly metadata is obtained by POST to
TOPIS `selectRefRoomListASC.do`; download uses the exact attachment fields from
that response. These are public website endpoints, not a versioned OpenAPI, so
schema failures stop ingestion instead of guessing. Three bounded attempts are
made for network failures; individual month failure does not overwrite good data.

Raw XLSX and parsed compressed rows are stored with SHA-256. Immutable versions
are retained after corrections. No private source is made publicly accessible;
the app exposes only these public TOPIS original workbooks. Source check time,
successful ingestion time, and failed run status are recorded separately.

## Calculation and display

- Monday-Sunday columns; 00:00-01:00 through 23:00-24:00 rows.
- Calendar clicks select whole weeks. Cross-month weeks use both stored months.
- Each value is a published hourly vehicle count, not PCU or a 15-minute peak.
- Both directions are added only at identical dates/hours and only if both exist.
- Missing/unparseable values remain null. Zero is valid and is not missing.
- Daily totals and daily peaks require all 24 hourly values.
- A definitive weekly peak day (largest daily total) and weekly peak hour
  (largest simultaneous hourly count) require all seven complete days.
- Daily maximum hours are shown for complete days even in an incomplete week.
- All ties are highlighted. All-zero periods have no distinguished peak.
- Amber = peak day, pale blue = each day's peak hours, dark blue = weekly maximum.
- Source holiday labels are preserved without shifting actual calendar weekdays.
- The nearby point is a distance-based suggestion, not certified representative.

No LLM or NotebookLM is involved in numeric extraction or calculation.

## Verification

`node --test tests/trafficPeak.test.mjs` covers dates, cross-year/month boundaries,
duplicates, null vs zero, missing directions, ties, holidays and workbook schema.
Live workbook checks and hosted workflow/production checks are separate evidence.
