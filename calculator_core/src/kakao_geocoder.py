from __future__ import annotations

import json
import os
import socket
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
KAKAO_ENDPOINT = "https://dapi.kakao.com/v2/local/search/address.json"
DEFAULT_ENV_FILE = ROOT / ".env.local"


_PROVINCE_ALIASES = {
    "서울특별시": "서울", "서울시": "서울", "부산광역시": "부산", "부산시": "부산",
    "대구광역시": "대구", "대구시": "대구", "인천광역시": "인천", "인천시": "인천",
    "광주광역시": "광주", "광주시": "광주", "대전광역시": "대전", "대전시": "대전",
    "울산광역시": "울산", "울산시": "울산", "세종특별자치시": "세종", "세종시": "세종",
    "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원",
    "충청북도": "충북", "충청남도": "충남", "전북특별자치도": "전북", "전라북도": "전북",
    "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주",
}


def normalize_address_for_comparison(value: str | None) -> str:
    """Normalize benign Korean address spelling differences without guessing a place."""
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    for long_name, short_name in sorted(_PROVINCE_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
        text = text.replace(long_name.lower(), short_name)
    text = re.sub(r"(?<=\d)\s*번지\b", "", text)
    # Keep hyphens because main/sub address numbers (for example 11-17) are semantic.
    return re.sub(r"[\s,().·]+", "", text)


class KakaoGeocoderError(RuntimeError):
    def __init__(self, code: str, message: str, *, http_status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name and name.replace("_", "").isalnum():
            values[name] = value.strip().strip("\"'")
    return values


def load_kakao_rest_key(env_file: Path | None = None) -> tuple[str | None, dict[str, Any]]:
    direct = os.environ.get("KAKAO_REST_API_KEY", "").strip().strip("\"'")
    if direct:
        return direct, {"variable": "KAKAO_REST_API_KEY", "source": "process environment"}
    path = env_file or DEFAULT_ENV_FILE
    value = _read_env_file(path).get("KAKAO_REST_API_KEY", "").strip()
    if value:
        return value, {"variable": "KAKAO_REST_API_KEY", "source": "ignored local env file"}
    return None, {"variable": "KAKAO_REST_API_KEY", "source": None}


def _error_message(payload: bytes) -> tuple[int | None, str | None]:
    try:
        data = json.loads(payload.decode("utf-8"))
        return data.get("code"), data.get("msg") or data.get("message")
    except Exception:
        return None, None


class KakaoAddressClient:
    def __init__(
        self,
        key: str | None = None,
        *,
        timeout_seconds: float = 7.0,
        opener: Callable[..., Any] = urlopen,
        env_file: Path | None = None,
    ) -> None:
        loaded, provenance = load_kakao_rest_key(env_file)
        self.key = (key or loaded or "").strip()
        self.key_provenance = provenance if key is None else {"variable": "injected test key", "source": "test injection"}
        self.timeout_seconds = float(timeout_seconds)
        self.opener = opener

    @property
    def configured(self) -> bool:
        return bool(self.key)

    def _request(self, query: str, analyze_type: str) -> dict[str, Any]:
        if not self.key:
            raise KakaoGeocoderError(
                "KEY_MISSING",
                "KAKAO_REST_API_KEY가 로컬 실행 환경에 없습니다. Vercel의 Sensitive 변수는 생성 후 값을 다시 읽을 수 없으므로 별도 로컬 비밀 설정이 필요합니다.",
            )
        url = KAKAO_ENDPOINT + "?" + urlencode({"query": query, "analyze_type": analyze_type, "page": 1, "size": 30})
        request = Request(url, headers={"Authorization": f"KakaoAK {self.key}", "Accept": "application/json"})
        try:
            with self.opener(request, timeout=self.timeout_seconds) as response:
                status = int(getattr(response, "status", 200))
                payload = response.read()
        except HTTPError as exc:
            payload = exc.read()
            api_code, _api_message = _error_message(payload)
            if exc.code in (401, 403) or api_code in (-3, -5, -8, -12, -13):
                code = "AUTHENTICATION_FAILED"
                safe_message = "카카오 REST API 인증에 실패했습니다. REST API 키 종류와 허용 설정을 확인하십시오"
            elif exc.code == 429 or api_code in (-10, -11):
                code = "QUOTA_OR_RATE_LIMIT"
                safe_message = "카카오 주소 API 호출 한도 또는 요청 제한에 도달했습니다"
            else:
                code = "KAKAO_HTTP_ERROR"
                safe_message = f"카카오 주소 API가 HTTP {exc.code} 오류를 반환했습니다"
            # Kakao may echo a malformed app key in its error text. Never expose
            # provider error bodies to UI, CLI, logs, reports, or saved results.
            raise KakaoGeocoderError(code, safe_message, http_status=exc.code) from None
        except (socket.timeout, TimeoutError):
            raise KakaoGeocoderError("TIMEOUT", "카카오 주소 API 응답 시간이 초과되었습니다") from None
        except URLError as exc:
            reason = exc.reason
            if isinstance(reason, (socket.timeout, TimeoutError)):
                raise KakaoGeocoderError("TIMEOUT", "카카오 주소 API 응답 시간이 초과되었습니다") from None
            raise KakaoGeocoderError("NETWORK_ERROR", "카카오 주소 API에 연결할 수 없습니다") from None
        if status != 200:
            raise KakaoGeocoderError("KAKAO_HTTP_ERROR", f"카카오 주소 API HTTP {status}", http_status=status)
        try:
            data = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise KakaoGeocoderError("INVALID_RESPONSE", "카카오 주소 API 응답 JSON을 해석할 수 없습니다") from None
        if not isinstance(data.get("documents"), list) or not isinstance(data.get("meta"), dict):
            raise KakaoGeocoderError("INVALID_RESPONSE", "카카오 주소 API 응답 필드가 예상 구조와 다릅니다")
        return data

    @staticmethod
    def _candidate(document: dict[str, Any], index: int) -> dict[str, Any]:
        address = document.get("address") or {}
        road = document.get("road_address") or {}
        try:
            longitude = float(document["x"])
            latitude = float(document["y"])
        except (KeyError, TypeError, ValueError):
            raise KakaoGeocoderError("INVALID_RESPONSE", "카카오 주소 응답의 x·y 좌표가 숫자가 아닙니다") from None
        address_type = str(document.get("address_type") or "")
        road_main = str(road.get("main_building_no") or "").strip()
        lot_main = str(address.get("main_address_no") or "").strip()
        is_specific_road = bool(road.get("address_name") and road_main)
        is_specific_lot = bool(address.get("address_name") and lot_main)
        is_region_representative = address_type == "REGION"
        if is_region_representative:
            specificity_status = "REGION_REPRESENTATIVE_NOT_A_SITE_ADDRESS"
            selection_eligible = False
        elif is_specific_road:
            specificity_status = "DETAILED_ROAD_ADDRESS"
            selection_eligible = True
        elif is_specific_lot:
            specificity_status = "DETAILED_LAND_LOT_ADDRESS"
            selection_eligible = True
        else:
            specificity_status = "ADDRESS_NUMBER_REQUIRED"
            selection_eligible = False
        return {
            "candidate_id": str(index),
            "address_name": document.get("address_name"),
            "address_type": address_type,
            "road_address_name": road.get("address_name"),
            "land_lot_address_name": address.get("address_name"),
            "building_name": road.get("building_name"),
            "road_main_building_no": road_main or None,
            "road_sub_building_no": str(road.get("sub_building_no") or "").strip() or None,
            "land_lot_main_address_no": lot_main or None,
            "land_lot_sub_address_no": str(address.get("sub_address_no") or "").strip() or None,
            "specificity_status": specificity_status,
            "selection_eligible": selection_eligible,
            "longitude": longitude,
            "latitude": latitude,
            "coordinate_contract": {"x": "longitude", "y": "latitude", "crs": "WGS84 longitude/latitude"},
            "administrative": {
                "region_1depth_name": address.get("region_1depth_name"),
                "region_2depth_name": address.get("region_2depth_name"),
                "region_3depth_name": address.get("region_3depth_name"),
                "region_3depth_h_name": address.get("region_3depth_h_name"),
                "administrative_dong_code_h": address.get("h_code"),
                "legal_dong_code_b": address.get("b_code"),
                "code_warning": "현재 행정·법정동 코드이며 O/D TAZ와 직접 동일시하지 않음",
            },
        }

    def search(self, query: str) -> dict[str, Any]:
        cleaned = " ".join(str(query or "").split())
        if len(cleaned) < 4:
            raise KakaoGeocoderError("ADDRESS_TOO_SHORT", "시도·시군구와 도로명 또는 지번을 포함한 주소를 입력하십시오")
        exact = self._request(cleaned, "exact")
        exact_documents = exact["documents"]
        if exact_documents:
            mode, response, documents = "exact", exact, exact_documents
        else:
            similar = self._request(cleaned, "similar")
            mode, response, documents = "similar", similar, similar["documents"]
        if not documents:
            raise KakaoGeocoderError("NO_RESULTS", "카카오 주소 검색 결과가 없습니다")
        candidates = [self._candidate(document, index) for index, document in enumerate(documents)]
        provider_total_count = int((response.get("meta") or {}).get("total_count") or 0)
        input_normalized = normalize_address_for_comparison(cleaned)
        for candidate in candidates:
            standards = {
                normalize_address_for_comparison(candidate.get("address_name")),
                normalize_address_for_comparison(candidate.get("road_address_name")),
                normalize_address_for_comparison(candidate.get("land_lot_address_name")),
            }
            standards.discard("")
            candidate["input_standard_match"] = input_normalized in standards
        one_received = len(candidates) == 1
        only = candidates[0] if one_received else None
        single_exact = bool(
            mode == "exact" and provider_total_count == 1 and one_received and only
            and only["selection_eligible"] and only["input_standard_match"]
        )
        if single_exact:
            status = "VERIFIED_SINGLE_EXACT"
            confirmation_reason = "상세 도로명 또는 지번, 입력-표준주소 일치, 제공자 전체 결과 1건"
        elif one_received and only and not only["selection_eligible"]:
            status = "ADDRESS_DETAIL_REQUIRED"
            confirmation_reason = "시군구·동 대표점 또는 번지·건물번호 없는 주소는 사업지 위치로 확정할 수 없음"
        else:
            status = "SELECTION_REQUIRED"
            confirmation_reason = (
                "유사·복수·건물명 검색 또는 입력 주소와 반환 표준주소 차이를 사용자가 확인해야 함"
            )
        return {
            "search_id": str(uuid.uuid4()),
            "status": status,
            "input_address": cleaned,
            "normalized_input_address": input_normalized,
            "analysis_type_used": mode,
            "candidate_count": len(candidates),
            "received_candidate_count": len(candidates),
            "provider_total_count": provider_total_count,
            "provider_pageable_count": int((response.get("meta") or {}).get("pageable_count") or provider_total_count),
            "provider_is_end": (response.get("meta") or {}).get("is_end"),
            "confirmation_reason": confirmation_reason,
            "auto_select_candidate_id": candidates[0]["candidate_id"] if single_exact else None,
            "candidates": candidates,
            "source": {
                "provider": "Kakao Local",
                "endpoint": KAKAO_ENDPOINT,
                "authentication": "REST API key in Python server Authorization header",
                "key_variable": "KAKAO_REST_API_KEY",
                "key_value_logged": False,
            },
        }
