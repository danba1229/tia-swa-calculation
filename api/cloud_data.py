from __future__ import annotations

import hashlib
import hmac
import json
import os
import shutil
import tempfile
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = PROJECT_ROOT / "calculator_core" / "cloud_data_bundle.json"
_LOCK = threading.Lock()
_STATUS: dict[str, Any] | None = None


class CloudDataError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        stage: str = "unknown",
        cause_class: str | None = None,
        http_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.cause_class = cause_class
        self.http_status = http_status


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _verify_files(root: Path, manifest: dict[str, Any]) -> None:
    failures = []
    for relative, expected in manifest["members"].items():
        path = root / relative
        if not path.is_file():
            failures.append(f"missing:{relative}")
            continue
        if path.stat().st_size != int(expected["size_bytes"]):
            failures.append(f"size:{relative}")
            continue
        if _sha256(path) != str(expected["sha256"]).upper():
            failures.append(f"sha256:{relative}")
    if failures:
        raise CloudDataError("계산자료 구성 파일 검증 실패: " + ",".join(failures[:5]))


def _safe_extract(archive_path: Path, destination: Path, manifest: dict[str, Any]) -> None:
    expected = set(manifest["members"])
    with zipfile.ZipFile(archive_path) as archive:
        actual = {name for name in archive.namelist() if not name.endswith("/")}
        if actual != expected:
            raise CloudDataError("계산자료 묶음의 파일 목록이 매니페스트와 다릅니다")
        for name in sorted(actual):
            pure = PurePosixPath(name)
            if pure.is_absolute() or ".." in pure.parts:
                raise CloudDataError("계산자료 묶음에 안전하지 않은 경로가 있습니다")
            target = destination.joinpath(*pure.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(name) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)


def _presigned_bundle_url(version: str) -> str:
    host = (
        os.getenv("VERCEL_PROJECT_PRODUCTION_URL", "").strip()
        or os.getenv("VERCEL_URL", "").strip()
    )
    secret = os.getenv("TIA_CALCULATOR_SESSION_SECRET", "").strip()
    if not host or len(secret) < 32:
        raise CloudDataError("계산자료 서버 연결 설정이 없습니다", stage="presign_configuration")
    timestamp = int(datetime.now(timezone.utc).timestamp())
    signature = hmac.new(
        secret.encode("utf-8"),
        f"data-bundle:{version}:{timestamp}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    body = json.dumps({
        "timestamp": timestamp,
        "version": version,
        "signature": signature,
    }, separators=(",", ":")).encode("utf-8")
    request = Request(
        f"https://{host}/api/indicator/data-url",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Cache-Control": "no-store"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise CloudDataError(
            "계산자료 읽기 URL을 준비하지 못했습니다",
            stage="presign_request",
            cause_class=exc.__class__.__name__,
            http_status=getattr(exc, "code", None) if isinstance(exc, HTTPError) else None,
        ) from exc
    url = str(payload.get("presignedUrl") or "")
    if not payload.get("success") or not url.startswith("https://"):
        raise CloudDataError("계산자료 읽기 URL이 유효하지 않습니다", stage="presign_response")
    return url


def _download_presigned(url: str, destination: Path) -> None:
    try:
        with urlopen(Request(url, method="GET"), timeout=45) as response, destination.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise CloudDataError(
            "private Blob 계산자료를 내려받지 못했습니다",
            stage="presigned_download",
            cause_class=exc.__class__.__name__,
        ) from exc


def prepare_runtime_data(request_headers: Mapping[str, str] | None = None) -> dict[str, Any]:
    global _STATUS
    with _LOCK:
        if _STATUS is not None:
            os.environ["TIA_COMMON_DATA_ROOT"] = _STATUS["root"]
            return dict(_STATUS)
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        if int(manifest.get("schema_version", 0)) != 1:
            raise CloudDataError("지원하지 않는 계산자료 묶음 매니페스트입니다")
        version = str(manifest["version"])
        root = Path(tempfile.gettempdir()) / "tia-indicator-data" / version
        ready = root / ".verified.json"
        if ready.is_file():
            try:
                marker = json.loads(ready.read_text(encoding="utf-8"))
                if marker.get("bundle_sha256") == manifest["bundle"]["sha256"]:
                    _verify_files(root, manifest)
                    _STATUS = {
                        "status": "VERIFIED_PRIVATE_BLOB_CACHE",
                        "verified": True,
                        "access": "PRIVATE_BLOB_OIDC_PRESIGNED",
                        "version": version,
                        "bundle_sha256": manifest["bundle"]["sha256"],
                        "bundle_size_bytes": int(manifest["bundle"]["size_bytes"]),
                        "verified_at_utc": marker.get("verified_at_utc"),
                        "root": str(root),
                    }
                    os.environ["TIA_COMMON_DATA_ROOT"] = str(root)
                    return dict(_STATUS)
            except (OSError, ValueError, KeyError, json.JSONDecodeError, CloudDataError):
                pass

        staging_parent = root.parent
        staging_parent.mkdir(parents=True, exist_ok=True)
        staging = staging_parent / f".{version}-{uuid.uuid4().hex}"
        archive_path = staging_parent / f".{version}-{uuid.uuid4().hex}.zip"
        try:
            _download_presigned(_presigned_bundle_url(version), archive_path)
            if archive_path.stat().st_size != int(manifest["bundle"]["size_bytes"]):
                raise CloudDataError("private Blob 계산자료 크기가 매니페스트와 다릅니다")
            if _sha256(archive_path) != str(manifest["bundle"]["sha256"]).upper():
                raise CloudDataError("private Blob 계산자료 SHA-256이 매니페스트와 다릅니다")
            staging.mkdir(parents=True, exist_ok=False)
            _safe_extract(archive_path, staging, manifest)
            _verify_files(staging, manifest)
            marker = {
                "version": version,
                "bundle_sha256": manifest["bundle"]["sha256"],
                "verified_at_utc": datetime.now(timezone.utc).isoformat(),
            }
            (staging / ".verified.json").write_text(json.dumps(marker, separators=(",", ":")), encoding="utf-8")
            if root.exists():
                shutil.rmtree(root)
            staging.replace(root)
            _STATUS = {
                "status": "VERIFIED_PRIVATE_BLOB_DOWNLOAD",
                "verified": True,
                "access": "PRIVATE_BLOB_OIDC_PRESIGNED",
                "version": version,
                "bundle_sha256": manifest["bundle"]["sha256"],
                "bundle_size_bytes": int(manifest["bundle"]["size_bytes"]),
                "verified_at_utc": marker["verified_at_utc"],
                "root": str(root),
            }
            os.environ["TIA_COMMON_DATA_ROOT"] = str(root)
            return dict(_STATUS)
        except CloudDataError:
            raise
        except Exception as exc:
            raise CloudDataError(
                "private Blob 계산자료를 준비하지 못했습니다",
                stage="bundle_verify_or_extract",
                cause_class=exc.__class__.__name__,
            ) from exc
        finally:
            archive_path.unlink(missing_ok=True)
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)


def runtime_data_status() -> dict[str, Any] | None:
    if not _STATUS:
        return None
    public = dict(_STATUS)
    public.pop("root", None)
    return public
