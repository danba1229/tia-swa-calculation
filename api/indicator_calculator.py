from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from api.cloud_data import CloudDataError, prepare_runtime_data, runtime_data_status

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CORE_ROOT = PROJECT_ROOT / "calculator_core"
sys.path.insert(0, str(CORE_ROOT))

from src.kakao_geocoder import (  # noqa: E402
    KakaoAddressClient,
    KakaoGeocoderError,
    normalize_address_for_comparison,
)


CALCULATOR: Any | None = None
GENERIC_ERROR_CLASS: type[Exception] | None = None
INSTANCE_ID = str(uuid.uuid4())
TOKEN_VERSION = 1
MAX_BODY_BYTES = 4_000_000


class AuthenticationError(ValueError):
    pass


class CalculationRequestError(ValueError):
    pass


def _secret() -> bytes:
    value = os.getenv("TIA_CALCULATOR_SESSION_SECRET", "").strip()
    if len(value) < 32:
        raise CalculationRequestError("클라우드 계산 세션 서명키가 설정되지 않았습니다")
    return value.encode("utf-8")


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _signed_payload(payload: dict[str, Any]) -> str:
    encoded = _b64_encode(_canonical(payload))
    signature = _b64_encode(hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def _verify_signed_payload(token: str) -> dict[str, Any]:
    try:
        encoded, supplied = token.split(".", 1)
        expected = _b64_encode(hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(supplied, expected):
            raise ValueError("signature")
        payload = json.loads(_b64_decode(encoded))
    except (ValueError, TypeError, json.JSONDecodeError):
        raise CalculationRequestError("주소 확인 토큰이 유효하지 않습니다. 주소를 다시 검색하십시오") from None
    if int(payload.get("exp", 0)) < int(time.time()):
        raise CalculationRequestError("주소 확인 시간이 만료되었습니다. 주소를 다시 검색하십시오")
    return payload


def _read_user(cookie_header: str | None) -> dict[str, str]:
    try:
        cookies = SimpleCookie()
        cookies.load(cookie_header or "")
        raw = cookies["tia_indicator_session"].value
        encoded, supplied = raw.split(".", 1)
        expected = _b64_encode(hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(supplied, expected):
            raise ValueError("signature")
        payload = json.loads(_b64_decode(encoded))
        if payload.get("v") != 1 or not payload.get("sub") or int(payload.get("exp", 0)) <= int(time.time()):
            raise ValueError("expired")
        return {"user_id": str(payload["sub"]), "username": str(payload.get("username") or "")}
    except (KeyError, ValueError, TypeError, json.JSONDecodeError):
        raise AuthenticationError("로그인이 필요합니다") from None


def _result_token_payload(result: dict[str, Any]) -> dict[str, Any]:
    payload = deepcopy(result)
    payload.pop("integrity_token", None)
    payload.pop("storage_envelope", None)
    payload.pop("runtime", None)
    return payload


def _sign_result(result: dict[str, Any]) -> dict[str, Any]:
    signed = deepcopy(result)
    digest = hmac.new(_secret(), _canonical(_result_token_payload(signed)), hashlib.sha256).digest()
    signed["integrity_token"] = f"v{TOKEN_VERSION}." + _b64_encode(digest)
    # The Node storage route verifies this opaque envelope without needing to
    # reproduce Python/JavaScript floating-point JSON formatting. Only the
    # result bytes signed here are decoded and persisted.
    encoded = _b64_encode(_canonical(signed))
    envelope_signature = _b64_encode(hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
    signed["storage_envelope"] = f"v{TOKEN_VERSION}.{encoded}.{envelope_signature}"
    return signed


def _verify_result_token(result: dict[str, Any]) -> None:
    supplied = str(result.get("integrity_token") or "")
    if not supplied.startswith(f"v{TOKEN_VERSION}."):
        raise CalculationRequestError("계산 결과 무결성 토큰이 없습니다. 다시 계산하십시오")
    expected = hmac.new(_secret(), _canonical(_result_token_payload(result)), hashlib.sha256).digest()
    if not hmac.compare_digest(supplied.split(".", 1)[1], _b64_encode(expected)):
        raise CalculationRequestError("브라우저 계산 결과가 변경되었거나 다른 배포 자료와 섞였습니다. 다시 계산하십시오")


def _verified_result(result: dict[str, Any]) -> dict[str, Any]:
    envelope = str(result.get("storage_envelope") or "")
    if envelope:
        try:
            version, encoded, supplied = envelope.split(".", 2)
            expected = _b64_encode(hmac.new(_secret(), encoded.encode("ascii"), hashlib.sha256).digest())
            if version != f"v{TOKEN_VERSION}" or not hmac.compare_digest(supplied, expected):
                raise ValueError("signature")
            restored = json.loads(_b64_decode(encoded))
            if not isinstance(restored, dict):
                raise ValueError("payload")
        except (ValueError, TypeError, json.JSONDecodeError):
            raise CalculationRequestError("저장 계산 결과 서명이 유효하지 않습니다. 다시 계산하십시오") from None
        _verify_result_token(restored)
        restored["storage_envelope"] = envelope
        return restored
    _verify_result_token(result)
    return result


def calculator() -> Any:
    global CALCULATOR, GENERIC_ERROR_CLASS
    if CALCULATOR is None:
        prepare_runtime_data()
        from src.generic_calculator import GenericCalculator, GenericCalculatorError

        GENERIC_ERROR_CLASS = GenericCalculatorError
        CALCULATOR = GenericCalculator()
    return CALCULATOR


def _address_search(address: str) -> dict[str, Any]:
    search = KakaoAddressClient().search(address)
    now = int(time.time())
    for candidate in search["candidates"]:
        if not candidate.get("selection_eligible"):
            candidate["candidate_token"] = None
            continue
        candidate["candidate_token"] = _signed_payload({
            "v": TOKEN_VERSION,
            "exp": now + 900,
            "search_id": search["search_id"],
            "candidate_id": candidate["candidate_id"],
            "normalized_input_address": search["normalized_input_address"],
            "candidate": {
                "address_name": candidate.get("address_name"),
                "road_address_name": candidate.get("road_address_name"),
                "land_lot_address_name": candidate.get("land_lot_address_name"),
                "specificity_status": candidate.get("specificity_status"),
                "input_standard_match": candidate.get("input_standard_match"),
                "longitude": candidate["longitude"],
                "latitude": candidate["latitude"],
                "administrative": candidate.get("administrative"),
            },
        })
    search["server_state"] = "STATELESS_SIGNED_CANDIDATES"
    return search


def _calculate(body: dict[str, Any]) -> dict[str, Any]:
    token = str(body.get("candidate_token") or "")
    address = str(body.get("address") or "").strip()
    if token:
        verified = _verify_signed_payload(token)
        if normalize_address_for_comparison(address) != verified["normalized_input_address"]:
            raise CalculationRequestError("현재 주소가 검색한 주소와 달라졌습니다. 주소를 다시 검색하십시오")
        candidate = verified["candidate"]
        latitude = float(candidate["latitude"])
        longitude = float(candidate["longitude"])
        standard_address = (
            candidate.get("road_address_name")
            or candidate.get("land_lot_address_name")
            or candidate.get("address_name")
        )
        resolution = {
            "status": "KAKAO_GEOCODED_USER_CONFIRMED",
            "input_address": address,
            "standard_address": standard_address,
            "coordinate_source": "Kakao Local address search x=longitude, y=latitude",
            "administrative_codes": candidate.get("administrative"),
            "address_specificity": candidate.get("specificity_status"),
            "input_standard_match": candidate.get("input_standard_match"),
            "search_id": verified["search_id"],
        }
    elif body.get("coordinate_mode") == "manual":
        latitude = float(body["latitude"])
        longitude = float(body["longitude"])
        resolution = {
            "status": "MANUAL_COORDINATE_ADDRESS_UNVERIFIED",
            "input_address": address,
            "standard_address": None,
            "coordinate_source": "user supplied WGS84",
            "administrative_codes": None,
        }
    else:
        raise CalculationRequestError("카카오 주소 후보를 확인하거나 수동 좌표 모드를 명시하십시오")
    result = calculator().calculate(
        address,
        int(body["target_year"]),
        latitude,
        longitude,
        int(body.get("od_year", 2023)),
        str(body.get("access_dataset") or "auto"),
        resolution,
    )
    return _sign_result(result)


def _reassign(body: dict[str, Any]) -> dict[str, Any]:
    result = body.get("result")
    if not isinstance(result, dict):
        raise CalculationRequestError("수정할 계산 결과가 없습니다")
    result = _verified_result(result)
    updated = calculator().reassign(result, body.get("changes") or {})
    return _sign_result(updated)


def dispatch(body: dict[str, Any]) -> dict[str, Any]:
    action = str(body.get("action") or "")
    started = time.perf_counter()
    if action == "health":
        result = {"status": "READY", "python_runtime": sys.version.split()[0]}
    elif action == "catalog":
        result = calculator().public_catalog()
    elif action == "address-search":
        result = _address_search(str(body.get("address") or ""))
    elif action == "calculate":
        result = _calculate(body)
    elif action == "reassign":
        result = _reassign(body)
    elif action == "verify-result":
        result_payload = body.get("result")
        if not isinstance(result_payload, dict):
            raise CalculationRequestError("검증할 계산 결과가 없습니다")
        _verified_result(result_payload)
        result = {"status": "VERIFIED_SIGNED_RESULT"}
    else:
        raise CalculationRequestError("지원하지 않는 계산 요청입니다")
    elapsed = round((time.perf_counter() - started) * 1000, 3)
    if isinstance(result, dict):
        result["runtime"] = {
            "instance_id": INSTANCE_ID,
            "elapsed_ms": elapsed,
            "executed_at_utc": datetime.now(timezone.utc).isoformat(),
            "computer_dependency": "VERCEL_PYTHON_FUNCTION_PRIVATE_BLOB_VERIFIED_DERIVED_DATA",
            "data_bundle": runtime_data_status(),
        }
    return result


class handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if urlparse(self.path).path.endswith("/indicator_calculator"):
            self._json(200, {"status": "READY", "instance_id": INSTANCE_ID})
        else:
            self._json(404, {"status": "ERROR", "error": "not found"})

    def do_POST(self) -> None:
        stage = "request_headers"
        try:
            from vercel.headers import set_headers

            request_headers = dict(self.headers.items())
            set_headers(request_headers)
            # The private Blob SDK resolves its short-lived OIDC credential from
            # the current Vercel request headers. No long-lived Blob token is
            # stored in code or returned to the browser.
            stage = "authenticate"
            _read_user(self.headers.get("Cookie"))
            stage = "read_request"
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                self._json(413, {"status": "ERROR", "error_code": "PAYLOAD_SIZE", "error": "요청 크기가 허용 범위를 벗어났습니다"})
                return
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            stage = f"dispatch_{str(body.get('action') or 'unknown')[:32]}"
            self._json(200, dispatch(body))
        except AuthenticationError as exc:
            self._json(401, {"status": "ERROR", "error_code": "AUTH_REQUIRED", "error": str(exc)})
        except KakaoGeocoderError as exc:
            self._json(400, {"status": "ERROR", "error_code": exc.code, "error": str(exc), "http_status": exc.http_status})
        except CloudDataError:
            self._json(503, {"status": "ERROR", "error_code": "CALCULATION_DATA_UNAVAILABLE", "error": "검증된 계산자료를 준비하지 못했습니다. 잠시 후 다시 시도하십시오"})
        except (CalculationRequestError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"status": "ERROR", "error_code": "VALIDATION_ERROR", "error": str(exc)})
        except Exception as exc:
            if GENERIC_ERROR_CLASS is not None and isinstance(exc, GENERIC_ERROR_CLASS):
                self._json(400, {"status": "ERROR", "error_code": "VALIDATION_ERROR", "error": str(exc)})
            else:
                # Do not log request bodies, addresses, cookies, provider
                # responses, environment values or exception messages.
                sys.stderr.write(json.dumps({
                    "event": "indicator_calculator_failure",
                    "at": datetime.now(timezone.utc).isoformat(),
                    "stage": stage,
                    "error_class": exc.__class__.__name__,
                    "instance_id": INSTANCE_ID,
                }, separators=(",", ":")) + "\n")
                self._json(500, {"status": "ERROR", "error_code": "INTERNAL_ERROR", "error": "계산 처리 중 오류가 발생했습니다"})
