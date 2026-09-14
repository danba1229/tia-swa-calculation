from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the immutable private-Blob calculator data bundle")
    parser.add_argument("--source-root", type=Path, required=True, help="calculator_core containing common_data")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest-output", type=Path, required=True)
    args = parser.parse_args()

    source_root = args.source_root.resolve()
    inner_manifest_path = source_root / "common_data" / "derived" / "manifest.json"
    inner = json.loads(inner_manifest_path.read_text(encoding="utf-8"))
    members: dict[str, dict[str, object]] = {}

    def add(relative: str, expected_hash: str, expected_size: int | None = None) -> None:
        normalized = relative.replace("\\", "/")
        path = source_root / normalized
        if not path.is_file():
            raise FileNotFoundError(path)
        actual_size = path.stat().st_size
        actual_hash = sha256(path)
        if actual_hash != str(expected_hash).upper():
            raise ValueError(f"SHA-256 mismatch before bundling: {normalized}")
        if expected_size is not None and actual_size != int(expected_size):
            raise ValueError(f"size mismatch before bundling: {normalized}")
        members[normalized] = {"size_bytes": actual_size, "sha256": actual_hash}

    boundary = inner["sources"]["boundary"]
    add(boundary["primary_file"], boundary["primary_sha256"])
    add(boundary["fallback_file"], boundary["fallback_sha256"])
    for key in ("zones", "matrix", "purpose_outbound", "national_indicators", "national_zones", "region_crosswalk"):
        item = inner["derived"][key]
        add(item["file"], item["sha256"], item.get("expected_bytes"))
    for item in inner["derived"]["national_matrices"].values():
        add(item["file"], item["sha256"], item.get("expected_bytes"))
    add("common_data/derived/manifest.json", sha256(inner_manifest_path), inner_manifest_path.stat().st_size)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    preliminary = args.output_dir / "common_data_bundle.zip"
    with zipfile.ZipFile(preliminary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in sorted(members):
            info = zipfile.ZipInfo(relative, date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, (source_root / relative).read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    bundle_hash = sha256(preliminary)
    version = f"2024-od-v1-{bundle_hash[:16].lower()}"
    final_path = args.output_dir / f"tia-indicator-{version}.zip"
    if final_path.exists():
        if sha256(final_path) != bundle_hash:
            raise FileExistsError(final_path)
        preliminary.unlink()
    else:
        preliminary.replace(final_path)
    payload = {
        "schema_version": 1,
        "version": version,
        "built_at_utc": datetime.now(timezone.utc).isoformat(),
        "blob_path": f"tia-indicator-data/{version}/common_data_bundle.zip",
        "bundle": {"size_bytes": final_path.stat().st_size, "sha256": bundle_hash},
        "members": members,
        "inner_manifest_sha256": members["common_data/derived/manifest.json"]["sha256"],
        "source_scope": "verified derived traffic indicators, O/D matrices, zone crosswalk and representative boundaries",
    }
    args.manifest_output.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"bundle": str(final_path), "version": version, "size_bytes": final_path.stat().st_size, "sha256": bundle_hash, "member_count": len(members)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
