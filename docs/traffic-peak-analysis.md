# Monthly traffic collection and weekly peak analysis

## Survey map linkage (2026-10-07)

- The shared Kakao map shows up to three recommended GITS points with rank, station code and an approximate-position label. These are section-name geocoding results, not official measuring coordinates.
- A selected Gyeonggi hourly analysis station is independent of the GITS recommendation. Its source municipality and landmark are searched using the existing Kakao SDK. Only same-municipality results are offered; a user must confirm a result before an orange reference marker is displayed.
- The source API supplies no verified coordinates. Missing locations stay unplotted; no project centroid or GITS location is substituted. Reference positions do not affect station matching, ranking, distance or measured traffic.
- Changing address, station or month clears the previous reference selection. Pending stale lookups cannot replace the current selection. Positions are session-only and require confirmation again after reload.
- Map recreation and visibility changes rebuild the layer; expanding/collapsing preserves bounds including the selected points. A map checkbox and fit-to-points button control this layer independently of bus/bicycle layers.
- Overlapping labels are offset in screen space within the map viewport. Map pins retain their original coordinates; zoom/pan updates the label layout and cleanup removes the map listener.
- Production browser verification: Suwon City Hall, 800 x 800 m scope, three GITS markers and reference 4302-03 (user-confirmed Annyoung IC place result). Toggle off removed all four, toggle on restored all four. This verifies rendering and interaction, not survey-location accuracy. Automated suite: 216 tests plus lint and production build passed.

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
- Each GITS recommendation has a peak-analysis connection link. Automatic
  connection requires the exact station code, route name, jurisdiction and
  source year to match the selected observation month. Codes are not padded,
  truncated or matched fuzzily. Missing/ambiguous metadata blocks connection.
- If no match exists, the UI says there is no linked hourly source. The user
  must explicitly enable separate-reference mode and select an actual catalog
  point. Route/region/code text search is available, but it is not proximity
  ranking. Unverified coordinates/distances are never nearest-point evidence.
- Reference results and CSV identify both the original GITS candidate and
  actual analyzed station, observation month, connection status and source
  hash. Reference traffic is not substituted for the GITS station measurement.
- Changing the address or candidate resets the reference choice and results.
  Source/month/station/context changes cannot show a previous result as current.
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

### TOPIS diagnostics and delayed recovery

- Each request logs JSON with endpoint path (no query/body), attempt, HTTP status,
  connect/http/body/decode stage, elapsed milliseconds and bounded nested error
  names/codes/syscalls. `AggregateError.errors` is included for IPv4/IPv6 failures.
  Raw error messages, response bodies, credentials and DB URLs are never logged.
- Transient transport errors, HTTP 408/429/5xx receive up to three requests with
  1.5/3 second delays. Retry-After is respected up to 60 seconds. Certificate/TLS,
  HTTP 4xx other than 408/429, JSON/schema and workbook validation failures stop.
- If source connectivity still fails, retry affected years/months after 2 minutes
  and then 5 minutes (three collection rounds maximum). Completed months are
  skipped within the run. Unchanged fingerprints avoid file downloads. Validation
  failures remain failed even if a different month's transient failure recovers.
- DB errors stop the run, rather than being mistaken for source network errors.
  GitHub job timeout is 40 minutes; exhaustion/validation failure exits nonzero.
  No source data is deleted or replaced by an empty result on failure. Recovery
  records CHECKED/NO_CHANGE/UPDATED; earlier failure records remain in the audit.
- The manual GitHub workflow may run on a feature branch for authorized collection
  verification. It uses the existing database secret; it does not merge code or
  deploy production. Scheduled runs still use main until the PR is approved.

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

### Survey region from the resolved address (2026-10-14)

STEP 2 chooses TOPIS/GITS from the current successful geocode's structured
`matchedAddress`, while preserving the address typed by the user. For example,
`서초구 남부순환로 2584` resolves to `서울 서초구 남부순환로 2584` and selects
Seoul even when the input omits the province. The resolved address also drives
recommendation sources, survey map overlays and the GITS candidate API request.
Candidate distance calculations reuse that geocode's coordinates.

Pending, failed, empty or stale address results cannot retain the previous
survey region or start peak analysis. A successful response without a structured
matched address asks the user to check the address instead of guessing from
the input or a status message. Other research steps retain their existing logic.

This does not change the sequential geocoding of the 139 TOPIS points on a cold
browser cache; first-time recommendations can still take about a minute.

`npm run build` passes lint, all 287 tests and the production build.
`scripts/check_survey_address_ui.mjs` verifies the local build through the real
public geocoding API and Kakao SDK, isolating unrelated API calls. It checks
province-less Seoul input, three recommendations/map markers, a switch to
Gyeonggi, and clearing candidates/analysis after a failed or empty address.

`node --test tests/trafficPeak.test.mjs` covers dates, cross-year/month boundaries,
duplicates, null vs zero, missing directions, ties, holidays and workbook schema.
Live workbook checks and hosted workflow/production checks are separate evidence.

### Gyeonggi connection verification (2026-10-07)

- The public production catalog contained 53 unique hourly station codes over
  2024-01 through 2024-12. None exactly matched the 582 stored GITS codes.
  This is source coverage, not evidence that the GITS stations have zero traffic.
- Local UI using the production public read API: candidate 0309-04 showed
  NO_DATA and did not start analysis until separate-reference mode was chosen.
- Reference 4302-03, week 2024-12-02 through 2024-12-08, both directions:
  168 valid hours, peak day 2024-12-06 at 70,595 vehicles/day, weekly peak
  17:00-18:00 that day at 4,966 vehicles/hour. These are the reference point's
  observations, not Suwon candidate 0309-04's traffic.
- Actual CSV download preserved the two different codes and reference warning.
  Switching the candidate to 00132-1 cleared the table and disabled CSV export.
- `tests/trafficPointLink.test.mjs` covers exact metadata matching, ambiguous
  codes, missing data, provenance and selection identity. Full suite: 210 tests.
- This connection change has been verified locally, not deployed in this task.
