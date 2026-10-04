# STEP 5: Seoul and Gyeonggi transport

The address and rectangular map bounds drive the existing Seoul bus snapshot,
Gyeonggi GBIS base files, and Kakao SW8 subway locations. The station coordinates
are tested against the rectangle again on the server. Distances are straight-line.

## Server secrets

- `GYEONGGI_BUS_BASE_API_KEY`: GBIS base-file versions and download locations.
- `GYEONGGI_BUS_ROUTE_API_KEY`: route detail and day-specific intervals.
- `GYEONGGI_BUS_STATION_API_KEY`: supplement stops without base-file route links
  (up to eight missing stops per request, with an explicit warning for remaining
  gaps). Rectangle search uses the complete station base file, not one 500m query.
- `TAGO_SUBWAY_API_KEY`: subway station identifiers and station timetables.
- `SEOUL_TDATA_API_KEY`: T-DATA active-route Saturday and holiday intervals.
- Existing `KAKAO_REST_API_KEY`: subway coordinates (server only).
- `SEOUL_SUBWAY_API_KEY`: Seoul station registry and day/direction timetables.
  The user approved server-side HTTP to `openapi.seoul.go.kr:8088`.
  The key travels unencrypted on that upstream connection, never in browser code.

Keys must be stored as Vercel Secrets in Production and Preview. Never log a
credential-bearing upstream URL. The public browser map continues to use the
existing Kakao JavaScript key; REST/data keys are not client-visible.

## Integrity and limits

- GBIS file downloads follow the exact official host/path/version, with no
  redirects. Public base files use HTTP and contain no authentication key.
  Authenticated GBIS, TAGO, T-DATA and Kakao calls use HTTPS.
- GBIS base files, route details, T-DATA and subway timetables are compressed in
  the existing dedicated Seoul bus Neon DB (`transport_response_cache`). A
  distributed 90-second lease prevents concurrent cold servers downloading the
  same resource. In-process promises also coalesce duplicate requests.
- These records expire at 04:00 KST on the fifth of each month and refresh on
  their next use, not by bulk-polling every station. Existing Seoul bus cron is
  unchanged. Subway location/name lookup and missing GBIS links cache for one
  day. Empty or partial schedules retry after five minutes.
- Failed refreshes retain previous valid data for up to 45 days and return a
  visible stale warning. Failures never replace missing data with zero. Without
  a working DB, valid live data is returned with a MEMORY cache status; cold
  servers can then repeat calls. No new paid service is required.
- Bus origin departure times are never substituted for stop departure times.
  GBIS does not provide the latter in the connected operations.
- T-DATA rows must match an exact active route ID uniquely. Its general interval
  is not relabeled as weekday; Saturday/holiday fields are separate. Pagination
  repetition or duplicate IDs leaves supplementation unavailable.
- Subway codes require exact normalized station AND line matches. Unknown or
  ambiguous matches stay visible for manual review.
- Kakao category queries page through the provider's 45-result ceiling. The UI
  warns when that ceiling is reached. No full-coverage claim is made then.
- Seoul timetables are preferred when station AND line match uniquely. TAGO
  supplies the fallback, per day and direction, with reported pages consumed.
  Missing Saturdays are NOT copied from weekdays or holidays. Each destination
  is summarized separately. 00:00-02:59 is treated as the previous service day's
  next-day departure; this convention is shown in the UI. Temporary service
  changes and missing express/local distinctions still need operator confirmation.
  Available train types and timetable sources remain separate in the table/CSV.
- Partially missing/malformed timetable rows are explicitly warned about.
  Source query timestamp is not a timetable revision date.
- Bus and subway failures do not delete the other successful results.
- CSV/clipboard export includes both bus and subway tables; STEP 6 remains bikes.

## Verification

```
node --test --test-isolation=none tests/*.test.mjs
npm run build
node --env-file=.env.local scripts/check_transport_live.mjs
```

Live checks consume API calls. The script prints selected public results, not
keys. Vercel Secrets cannot be pulled back for local verification; verify those
integrations on a Preview deployment instead of replacing them with placeholders.

Official references:
- https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBaseInfo
- https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusRouteInfo
- https://www.data.go.kr/data/15098554/openapi.do
- https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=1053
- https://data.seoul.go.kr/dataList/OA-101/A/1/datasetView.do
