# Seoul bicycle station refresh

- Source: https://data.seoul.go.kr/dataList/OA-13252/F/1/datasetView.do
- Monthly check: first day of each month, 01:00 UTC / 10:00 Asia/Seoul (platform execution may be delayed within the hour).
- Authenticated endpoint: GET /api/cron/seoul-bike-sync, CRON_SECRET bearer header. Uses existing DATABASE_URL / POSTGRES_URL, or SEOUL_BUS_DATABASE_URL / SEOUL_BUS_POSTGRES_URL fallback. No new API key.
- Discover the latest official XLSX by reference month, then hash its bytes. Revisions with the same reference month are detected. The reference month is not converted into an invented day.
- Files are processed in memory only. No local downloads are deleted; Google Drive is not connected. Original XLSX bytes are not archived.
- LCD and QR rack columns are summed; both blank means null, not zero. Missing addresses remain blank and the UI uses the district as a location fallback. Invalid coordinates, duplicate IDs, schema changes or a count change below 80% / above 125% reject the update.
- Neon table seoul_bike_snapshot retains the current and previous successful parsed snapshots, file name, URL, SHA-256, reference month and collection time. Initial promotion retains the bundled 2025-12 snapshot as previous.
- A two-minute lease prevents concurrent promotion. Atomic update retains the existing snapshot on errors. Unchanged files update check status/time only. DB outages use the process's last cached data or bundled fallback with an explicit warning.
- Existing saved survey results retain their data version. A fresh survey reads the latest snapshot. CSV includes source version and hash.
- No original-file evidence archive is promised. Add a separately approved archive if retaining the exact workbook is required.
- The app's top-level investigation still queries all steps; this schedule only updates the shared bicycle master dataset.
