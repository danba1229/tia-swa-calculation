from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import uuid
from array import array
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from src.common_data import (
    BOUNDARY_GEOJSON,
    BOUNDARY_REFERENCE_GEOJSON,
    MANIFEST_JSON,
    MATRIX_BIN,
    NATIONAL_INDICATOR_JSON,
    NATIONAL_ZONE_JSON,
    REGION_CROSSWALK_JSON,
    ZONE_COUNT,
    ZONE_JSON,
    NATIONAL_YEARS,
    national_matrix_path,
    point_in_geometry,
    point_on_geometry_boundary,
    sha256_file,
)
from src.indicator_projection import IndicatorProjectionError, cagr_project_decimal
from src.kakao_geocoder import KakaoAddressClient

YEARS = NATIONAL_YEARS


def region_group_name(region_name: str | None) -> str:
    """Cloud runtime grouping without importing legacy Excel modules."""
    if not region_name:
        return "지역명 미확인"
    parts = str(region_name).split()
    if len(parts) == 1:
        return parts[0]
    if parts[0] == "경기도" and len(parts) >= 3 and parts[1].endswith("시") and parts[2].endswith("구"):
        return " ".join(parts[:3])
    return " ".join(parts[:2])


ROOT = Path(os.getenv("TIA_COMMON_DATA_ROOT") or Path(__file__).resolve().parents[1]).resolve()
SOURCE_ROOT = ROOT.parent / "_analysis_readonly" / "source"
PURPOSE_BUNDLE = SOURCE_ROOT / "2024-OD-PSN-OBJ-00 전국지역간 목적 OD(250존)(2023-2050).zip"
MODE_BUNDLE = SOURCE_ROOT / "2024-OD-PSN-MOD-10 전국지역간 주수단 OD(250존)(2023-2050).zip"
ASSIGNMENT_DIR = ROOT / "direction_assignments"
OUTPUT_DIR = ROOT / "calculator_output"
DIRECTIONS = ("north", "east", "south", "west")
VALID_ASSIGNMENTS = {*DIRECTIONS, "excluded", "auto"}
DIRECTION_RULE_VERSION = "geographic-initial-bearing-v1"
METRO_DATASET = "metro_capital_region_2023"
METRO_LIMITED_DATASET = "metro_capital_linkage_only_2023"
NATIONAL_DATASET_PREFIX = "national_250_purpose_total_"


class GenericCalculatorError(ValueError):
    pass


def _round_display(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def initial_bearing(latitude1: float, longitude1: float, latitude2: float, longitude2: float) -> float | None:
    """Initial great-circle bearing: north=0 degrees, clockwise."""
    if abs(latitude1 - latitude2) < 1e-12 and abs(longitude1 - longitude2) < 1e-12:
        return None
    phi1, phi2 = math.radians(latitude1), math.radians(latitude2)
    delta = math.radians(longitude2 - longitude1)
    x = math.sin(delta) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def bearing_direction(bearing: float | None) -> str | None:
    if bearing is None or not math.isfinite(bearing):
        return None
    normalized = bearing % 360.0
    if normalized >= 315.0 or normalized < 45.0:
        return "north"
    if normalized < 135.0:
        return "east"
    if normalized < 225.0:
        return "south"
    return "west"


def _unique_path(folder: Path, stem: str, suffix: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    candidate = folder / f"{stem}{suffix}"
    index = 1
    while candidate.exists():
        candidate = folder / f"{stem}_{index}{suffix}"
        index += 1
    return candidate


def verify_file_against_manifest(path: Path, expected_hash: str, expected_size: int | None, label: str) -> None:
    """Use the same fail-closed integrity check in production and isolated tests."""
    if not path.is_file():
        raise GenericCalculatorError(f"{label}: 누락")
    if expected_size is not None and path.stat().st_size != int(expected_size):
        raise GenericCalculatorError(f"{label}: 크기 불일치")
    if sha256_file(path) != expected_hash:
        raise GenericCalculatorError(f"{label}: SHA-256 불일치")


def load_verified_double_array(
    path: Path,
    expected_hash: str,
    expected_size: int | None,
    expected_count: int,
    label: str,
) -> tuple[array, dict[str, Any]]:
    """Hash the exact bytes deserialized into the calculation array."""
    if not path.is_file():
        raise GenericCalculatorError(f"{label}: 누락")
    raw = path.read_bytes()
    actual_size = len(raw)
    if expected_size is not None and actual_size != int(expected_size):
        raise GenericCalculatorError(f"{label}: 실제 읽은 바이트 크기 불일치")
    actual_hash = hashlib.sha256(raw).hexdigest().upper()
    if actual_hash != str(expected_hash).upper():
        raise GenericCalculatorError(f"{label}: 실제 읽은 바이트 SHA-256 불일치")
    values = array("d")
    values.frombytes(raw)
    if len(values) != int(expected_count):
        raise GenericCalculatorError(f"{label}: 행렬 원소 수 불일치 ({len(values)} != {expected_count})")
    return values, {
        "status": "VERIFIED_EXACT_BYTES_BEFORE_DESERIALIZATION",
        "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        "file": str(path.resolve()),
        "size_bytes": actual_size,
        "sha256": actual_hash,
        "element_count": len(values),
    }


class GenericCalculator:
    def __init__(self) -> None:
        required = (
            ZONE_JSON, MATRIX_BIN, NATIONAL_INDICATOR_JSON, NATIONAL_ZONE_JSON,
            REGION_CROSSWALK_JSON, MANIFEST_JSON, BOUNDARY_GEOJSON,
            BOUNDARY_REFERENCE_GEOJSON,
            *(national_matrix_path(year) for year in NATIONAL_YEARS),
        )
        for path in required:
            if not path.is_file():
                raise GenericCalculatorError(f"범용 계산 필수 자료가 없습니다: {path}")
        self.manifest = json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))
        self._verify_integrity()
        self.zone_payload = json.loads(ZONE_JSON.read_text(encoding="utf-8"))
        self.zones = self.zone_payload["zones"]
        self.zone_by_taz = {int(row["taz"]): row for row in self.zones}
        self.zone_by_admin10 = {row["admin_code"]: row for row in self.zones if int(row["scope_flag"]) == 1}
        self.zone_by_sgg5 = {row["admin_code"]: row for row in self.zones if int(row["scope_flag"]) == 2}
        metro_item = self.manifest["derived"]["matrix"]
        self.metro_matrix, self.metro_matrix_integrity = load_verified_double_array(
            MATRIX_BIN, metro_item["sha256"], metro_item.get("expected_bytes"),
            ZONE_COUNT * ZONE_COUNT, "수도권 계산 O/D 행렬",
        )
        boundary_payload = json.loads(BOUNDARY_GEOJSON.read_text(encoding="utf-8"))
        self.boundaries = boundary_payload["features"]
        reference_payload = json.loads(BOUNDARY_REFERENCE_GEOJSON.read_text(encoding="utf-8"))
        self.reference_boundaries = reference_payload["features"]
        self.national = json.loads(NATIONAL_INDICATOR_JSON.read_text(encoding="utf-8"))
        self.national_zones_payload = json.loads(NATIONAL_ZONE_JSON.read_text(encoding="utf-8"))
        self.national_zones = self.national_zones_payload["zones"]
        self.national_zone_by_id = {int(row["zone_250"]): row for row in self.national_zones}
        crosswalk = json.loads(REGION_CROSSWALK_JSON.read_text(encoding="utf-8"))
        self.crosswalk_audit = crosswalk["audit"]
        self.region_crosswalk = {
            (row["metro_region"]["province"], row["metro_region"]["city_county"]): row
            for row in crosswalk["rows"] if row["status"] == "VERIFIED"
        }
        self.national_matrices: dict[int, tuple[array, dict[str, Any]]] = {}

    @staticmethod
    def _manifest_path(root: Path, item: dict[str, Any], key: str = "file") -> Path:
        return (root / item[key]).resolve()

    def _verify_integrity(self) -> None:
        if int(self.manifest.get("schema_version", 0)) < 2:
            raise GenericCalculatorError("공통 자료 매니페스트가 구버전입니다. prepare-common-data --overwrite를 실행하십시오")
        checks: list[tuple[Path, str, int | None, str]] = []
        sources = self.manifest["sources"]
        derived = self.manifest["derived"]
        checks.extend([
            (self._manifest_path(ROOT, sources["boundary"], "primary_file"), sources["boundary"]["primary_sha256"], None, "2023 경계"),
            (self._manifest_path(ROOT, sources["boundary"], "fallback_file"), sources["boundary"]["fallback_sha256"], None, "2022 기준 경계"),
        ])
        for name in ("zones", "matrix", "purpose_outbound", "national_indicators", "national_zones", "region_crosswalk"):
            item = derived[name]
            checks.append((self._manifest_path(ROOT, item), item["sha256"], item.get("expected_bytes"), f"파생자료 {name}"))
        for year, item in derived["national_matrices"].items():
            checks.append((self._manifest_path(ROOT, item), item["sha256"], item.get("expected_bytes"), f"전국 O/D {year}"))
        failures = []
        for path, expected_hash, expected_size, label in checks:
            try:
                verify_file_against_manifest(path, expected_hash, expected_size, label)
            except GenericCalculatorError as exc:
                failures.append(str(exc))
        if failures:
            raise GenericCalculatorError("핵심 계산자료 무결성 검사 실패: " + "; ".join(failures))
        self.integrity_verified_at_utc = datetime.now(timezone.utc).isoformat()
        self.runtime_data_profile = "CLOUD_DERIVED_RUNTIME_ONLY"

    def public_catalog(self) -> dict[str, Any]:
        return {
            "status": "READY" if KakaoAddressClient().configured else "READY_WITH_MANUAL_COORDINATE_ONLY",
            "address_modes": [
                {"id": "manual_wgs84", "label": "주소 + WGS84 위·경도", "status": "VERIFIED_LOCAL_FLOW"},
                {"id": "kakao_rest", "label": "카카오 주소 검색", "status": "CONFIGURED" if KakaoAddressClient().configured else "LOCAL_REST_KEY_REQUIRED"},
            ],
            "indicator": {
                "source": "2024 전국 여객O/D 보완갱신 250존",
                "years": list(YEARS),
                "target_year_range": [min(YEARS), max(YEARS)],
                "purpose_categories": ["출근", "등교", "업무", "귀가", "기타"],
                "mode_categories": ["승용차", "버스", "지하철", "일반철도", "고속철도", "항공", "해운"],
                "precision_policy": "원자료 소수로 CAGR 계산; 화면 표시만 정수 ROUND_HALF_UP",
                "spatial_resolution": "전국 250존 시군구 단위",
            },
            "access_od": [
                {"id": METRO_DATASET, "source": "2024 수도권 목적 O/D ODTRIP23_F", "scenario_years": [2023], "selection": "목적 5종 합계", "unit": "여객통행/일", "zone_system": "metro-2024-1310", "scope": "수도권 내부 일반 접근강도"},
                {"id": METRO_LIMITED_DATASET, "source": "2024 수도권 목적 O/D ODTRIP23_F", "scenario_years": [2023], "selection": "목적 5종 합계", "unit": "여객통행/일", "zone_system": "metro-2024-1310", "scope": "수도권 밖 사업지의 수도권 연계 통행만", "warning": "외부→외부 통행 29,929쌍은 미수록 0이므로 전국 일반 접근강도가 아님"},
                {"id": "national_250_purpose_total", "source": "2024 전국지역간 목적 O/D", "scenario_years": list(NATIONAL_YEARS), "selection": "목적 5종 합계", "unit": "여객통행/일 (AAWDT)", "zone_system": "national-2024-250", "scope": "전국 시군구 250존 일반 접근강도", "warning": "시군구급의 낮은 공간 해상도"},
            ],
            "coordinates": self.zone_payload["coordinate_source"],
            "missing_coordinate_taz": self.zone_payload["missing_coordinate_taz"],
            "region_crosswalk_audit": self.crosswalk_audit,
            "integrity_status": "CLOUD_DERIVED_FILES_VERIFIED_AT_INITIALIZATION_AND_MATRIX_BYTES_VERIFIED_AT_LOAD",
        }

    def _resolve_point(self, latitude: float, longitude: float) -> dict[str, Any]:
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise GenericCalculatorError("위도·경도 범위를 확인하십시오")
        def matches_from(features: list[dict[str, Any]], version: str) -> tuple[list[dict[str, Any]], list[str]]:
            matches = []
            boundaries = []
            for feature in features:
                geometry = feature.get("geometry")
                if not geometry:
                    continue
                if point_on_geometry_boundary(longitude, latitude, geometry):
                    properties = feature.get("properties") or {}
                    boundaries.append(str(properties.get("adm_nm") or ""))
                if not point_in_geometry(longitude, latitude, geometry):
                    continue
                properties = feature.get("properties") or {}
                admin_code = str(properties.get("adm_cd2") or "")
                sgg_code = str(properties.get("sgg") or "")
                zone = self.zone_by_admin10.get(admin_code) or self.zone_by_sgg5.get(sgg_code)
                if zone:
                    join_code = admin_code if int(zone["scope_flag"]) == 1 else sgg_code
                    matches.append({"admin_code": join_code, "zone": zone, "boundary_name": properties.get("adm_nm"), "boundary_version": version})
            return matches, boundaries

        matches, edge_names = matches_from(self.boundaries, "20230101")
        if edge_names:
            raise GenericCalculatorError(f"좌표가 행정경계선에 있습니다. TAZ 확인이 필요합니다: {sorted(set(edge_names))[:5]}")
        if not matches:
            matches, edge_names = matches_from(self.reference_boundaries, "20220101")
            if edge_names:
                raise GenericCalculatorError(f"좌표가 2022 기준 행정경계선에 있습니다. TAZ 확인이 필요합니다: {sorted(set(edge_names))[:5]}")
        unique = {item["zone"]["taz"]: item for item in matches}
        if len(unique) != 1:
            raise GenericCalculatorError(
                "좌표를 1,310존 한 개로 확정하지 못했습니다. "
                f"일치 후보={sorted(unique)}. 경계·중첩 또는 존 기준시점 불일치 여부를 확인하십시오."
            )
        item = next(iter(unique.values()))
        detailed = int(item["zone"]["scope_flag"]) == 1
        version = item["boundary_version"]
        return {
            "taz": int(item["zone"]["taz"]),
            "zone": item["zone"],
            "boundary_name": item["boundary_name"],
            "boundary_version_used": version,
            "status": "DETERMINED_BY_POINT_IN_REFERENCE_BOUNDARY" if version == "20220101" else "DETERMINED_BY_POINT_IN_PRIMARY_BOUNDARY",
            "resolution": "읍면동" if detailed else "수도권 외부 시군구 집계존",
            "basis": (
                f"WGS84 point-in-polygon on {version} SGIS-derived boundary, joined to 2024 metro crosswalk "
                + ("by 10-digit administrative code" if detailed else "by 5-digit city/county code; coarse external zone")
            ),
        }

    @staticmethod
    def _bracket_year(target_year: int) -> tuple[int, int]:
        if target_year < YEARS[0] or target_year > YEARS[-1]:
            raise GenericCalculatorError(f"지표 목표연도 {target_year}은 지원 범위 {YEARS[0]}..{YEARS[-1]} 밖입니다")
        if target_year in YEARS:
            return target_year, target_year
        lower = max(year for year in YEARS if year < target_year)
        upper = min(year for year in YEARS if year > target_year)
        return lower, upper

    def _project_value(self, start_value: float | None, end_value: float | None, start_year: int, end_year: int, target_year: int) -> dict[str, Any]:
        if start_value is None or end_value is None:
            return {
                "raw": None,
                "display_integer": None,
                "status": "MISSING_SOURCE",
                "reason": "보정 구간의 원자료 값이 없으므로 임의로 0 또는 보간값을 만들지 않음",
                "anchors": {str(start_year): start_value, str(end_year): end_value},
            }
        if start_year == end_year:
            raw = Decimal(str(start_value))
            method = "SOURCE_SCENARIO_VALUE"
        else:
            try:
                raw = cagr_project_decimal(start_value, end_value, start_year, end_year, target_year)
                method = "CAGR_RAW_SOURCE_ANCHORS"
            except IndicatorProjectionError as exc:
                return {
                    "raw": None,
                    "display_integer": None,
                    "status": "UNPROJECTABLE",
                    "reason": str(exc),
                    "anchors": {str(start_year): start_value, str(end_year): end_value},
                }
        return {
            "raw": format(raw, "f"),
            "display_integer": _round_display(raw),
            "status": "CALCULATED",
            "method": method,
            "anchors": {str(start_year): start_value, str(end_year): end_value},
        }

    def _indicator(self, zone: dict[str, Any], target_year: int) -> dict[str, Any]:
        province = zone["province"]
        city_county = zone["city_county"]
        mapping = self.region_crosswalk.get((province, city_county))
        if not mapping:
            raise GenericCalculatorError(f"이 주소의 전국 250존 행정코드 기준 대응이 검증되지 않았습니다: {province} {city_county}")
        national_zone = mapping["national_region"]
        lower, upper = self._bracket_year(target_year)
        zone_id = int(national_zone["zone_250"])
        key = str(zone_id)
        start_population = self.national["population"][str(lower)].get(key)
        end_population = self.national["population"][str(upper)].get(key)
        start_purpose = self.national["purpose"][str(lower)][key]
        end_purpose = self.national["purpose"][str(upper)][key]
        start_mode = self.national["main_mode"][str(lower)][key]
        end_mode = self.national["main_mode"][str(upper)][key]
        purpose = {category: self._project_value(start_purpose[category], end_purpose[category], lower, upper, target_year) for category in self.national["categories"]["purpose"]}
        mode = {category: self._project_value(start_mode[category], end_mode[category], lower, upper, target_year) for category in self.national["categories"]["main_mode"]}
        population = (
            self._project_value(start_population, end_population, lower, upper, target_year)
            if start_population is not None and end_population is not None
            else {
                "raw": None,
                "display_integer": None,
                "status": "MISSING_SOURCE",
                "reason": f"전국 250존 인구 원자료에 zone {zone_id}가 없습니다",
                "anchors": {str(lower): start_population, str(upper): end_population},
            }
        )
        calculated = population["status"] == "CALCULATED" and all(
            item["status"] == "CALCULATED" for item in [*purpose.values(), *mode.values()]
        )
        purpose_complete = all(item["status"] == "CALCULATED" for item in purpose.values())
        mode_complete = all(item["status"] == "CALCULATED" for item in mode.values())
        purpose_raw_total = sum((Decimal(item["raw"]) for item in purpose.values()), Decimal("0")) if purpose_complete else None
        mode_raw_total = sum((Decimal(item["raw"]) for item in mode.values()), Decimal("0")) if mode_complete else None
        return {
            "status": "CALCULATED" if calculated else "PARTIALLY_CALCULATED",
            "target_year": target_year,
            "anchor_interval": [lower, upper],
            "spatial_scope": f"{province} {city_county}",
            "national_250_zone": national_zone,
            "region_mapping": mapping,
            "population": population,
            "purpose": purpose,
            "main_mode": mode,
            "purpose_raw_total": format(purpose_raw_total, "f") if purpose_raw_total is not None else None,
            "mode_raw_total": format(mode_raw_total, "f") if mode_raw_total is not None else None,
            "purpose_mode_raw_difference": format(purpose_raw_total - mode_raw_total, "f") if purpose_raw_total is not None and mode_raw_total is not None else None,
            "purpose_display_total": sum(item["display_integer"] for item in purpose.values()) if purpose_complete else None,
            "mode_display_total": sum(item["display_integer"] for item in mode.values()) if mode_complete else None,
            "completeness": {"population": population["status"] == "CALCULATED", "purpose_all_categories": purpose_complete, "main_mode_all_categories": mode_complete},
            "unit": "여객통행/일 (평일 평균 O/D; AAWDT)",
            "source": self.national["source"],
            "rounding": "원자료 소수 정밀도로 계산하고 세부 분류별 표시값만 ROUND_HALF_UP 정수 반올림; 표시 합계는 표시 세부행 합",
        }

    @staticmethod
    def _matrix_flow(matrix: array, zone_count: int, origin: int, destination: int) -> float:
        return float(matrix[(origin - 1) * zone_count + (destination - 1)])

    def _national_matrix(self, year: int) -> tuple[array, dict[str, Any]]:
        if year not in NATIONAL_YEARS:
            raise GenericCalculatorError(f"전국 250존 O/D 연도 {year}은 미제공입니다. 지원 연도={list(NATIONAL_YEARS)}")
        if year not in self.national_matrices:
            item = self.manifest["derived"]["national_matrices"][str(year)]
            values, provenance = load_verified_double_array(
                national_matrix_path(year), item["sha256"], item.get("expected_bytes"),
                250 * 250, f"전국 {year}년 계산 O/D 행렬",
            )
            self.national_matrices[year] = (values, provenance)
            return values, {**provenance, "cache_status": "VERIFIED_AND_LOADED_THIS_REQUEST"}
        values, provenance = self.national_matrices[year]
        return values, {
            **provenance,
            "cache_status": "PINNED_VERIFIED_IN_MEMORY_BYTES",
            "used_at_utc": datetime.now(timezone.utc).isoformat(),
        }

    def _direction_rows(
        self,
        target_taz: int,
        latitude: float,
        longitude: float,
        *,
        zones: list[dict[str, Any]],
        matrix: array,
        zone_count: int,
        zone_id_field: str,
    ) -> list[dict[str, Any]]:
        rows = []
        for zone in zones:
            taz = int(zone[zone_id_field])
            inflow = self._matrix_flow(matrix, zone_count, taz, target_taz)
            outflow = self._matrix_flow(matrix, zone_count, target_taz, taz)
            if taz == target_taz:
                direction = "internal"
                bearing = None
                source = "INTERNAL"
            elif zone["latitude"] is None or zone["longitude"] is None:
                direction = None
                bearing = None
                source = "UNASSIGNED_MISSING_COORDINATE"
            else:
                bearing = initial_bearing(latitude, longitude, float(zone["latitude"]), float(zone["longitude"]))
                direction = bearing_direction(bearing)
                source = "AUTO_GEOGRAPHIC_BEARING" if direction else "UNASSIGNED_COINCIDENT_POINT"
            rows.append({
                "taz": taz,
                "region_name": zone["region_name"],
                "group_name": region_group_name(zone["region_name"]),
                "latitude": zone["latitude"],
                "longitude": zone["longitude"],
                "bearing_degrees": bearing,
                "default_direction": direction,
                "current_direction": direction,
                "assignment_source": source,
                "inflow_to_target": inflow,
                "outflow_from_target": outflow,
            })
        return rows

    @staticmethod
    def aggregate(rows: list[dict[str, Any]], target_taz: int) -> dict[str, Any]:
        totals = {direction: {"inflow": 0.0, "outflow": 0.0, "zone_count": 0} for direction in DIRECTIONS}
        excluded = {"inflow": 0.0, "outflow": 0.0, "zone_count": 0}
        unassigned = {"inflow": 0.0, "outflow": 0.0, "zone_count": 0}
        internal = next(row for row in rows if int(row["taz"]) == int(target_taz))
        for row in rows:
            direction = row["current_direction"]
            if direction in DIRECTIONS:
                totals[direction]["inflow"] = math.fsum((totals[direction]["inflow"], float(row["inflow_to_target"])))
                totals[direction]["outflow"] = math.fsum((totals[direction]["outflow"], float(row["outflow_from_target"])))
                totals[direction]["zone_count"] += 1
            elif direction == "excluded":
                excluded["inflow"] = math.fsum((excluded["inflow"], float(row["inflow_to_target"])))
                excluded["outflow"] = math.fsum((excluded["outflow"], float(row["outflow_from_target"])))
                excluded["zone_count"] += 1
            elif direction != "internal":
                unassigned["inflow"] = math.fsum((unassigned["inflow"], float(row["inflow_to_target"])))
                unassigned["outflow"] = math.fsum((unassigned["outflow"], float(row["outflow_from_target"])))
                unassigned["zone_count"] += 1
        denominator_in = math.fsum(item["inflow"] for item in totals.values())
        denominator_out = math.fsum(item["outflow"] for item in totals.values())
        for item in totals.values():
            item["inflow_share"] = item["inflow"] / denominator_in if denominator_in else None
            item["outflow_share"] = item["outflow"] / denominator_out if denominator_out else None
        if unassigned["zone_count"]:
            status = "INCOMPLETE_UNASSIGNED_ZONES"
        elif denominator_in <= 0 and denominator_out <= 0:
            status = "UNAVAILABLE_ZERO_DENOMINATORS"
        elif denominator_in <= 0:
            status = "PARTIAL_ZERO_INFLOW_DENOMINATOR"
        elif denominator_out <= 0:
            status = "PARTIAL_ZERO_OUTFLOW_DENOMINATOR"
        else:
            status = "COMPLETE"
        return {
            "status": status,
            "directions": totals,
            "denominators": {"inflow": denominator_in, "outflow": denominator_out, "policy": "assigned external zones only"},
            "internal": {"taz": target_taz, "inflow": internal["inflow_to_target"], "outflow": internal["outflow_from_target"], "policy": "excluded from external denominators"},
            "excluded": excluded,
            "unassigned": unassigned,
            "share_sums": {
                "inflow": math.fsum(item["inflow_share"] for item in totals.values()) if denominator_in > 0 else None,
                "outflow": math.fsum(item["outflow_share"] for item in totals.values()) if denominator_out > 0 else None,
            },
            "completeness": {
                "all_external_zones_assigned": unassigned["zone_count"] == 0,
                "inflow_denominator_positive": denominator_in > 0,
                "outflow_denominator_positive": denominator_out > 0,
                "access_intensity_available": status == "COMPLETE",
            },
        }

    def calculate(
        self,
        address: str,
        target_year: int,
        latitude: float,
        longitude: float,
        od_year: int = 2023,
        access_dataset: str = "auto",
        address_resolution: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        target = self._resolve_point(float(latitude), float(longitude))
        indicator = self._indicator(target["zone"], int(target_year))
        mapping = indicator["region_mapping"]
        is_metro_internal = int(target["zone"]["scope_flag"]) == 1
        if access_dataset == "auto":
            access_dataset = METRO_DATASET if is_metro_internal else "national_250_purpose_total"
        if access_dataset == METRO_DATASET and not is_metro_internal:
            raise GenericCalculatorError(
                "수도권 밖 사업지에는 수도권 1,310존 O/D를 일반 접근강도로 사용할 수 없습니다. "
                "전국 250존 자료를 선택하거나 제한 분석을 명시적으로 선택하십시오"
            )
        if access_dataset in {METRO_DATASET, METRO_LIMITED_DATASET}:
            if int(od_year) != 2023:
                raise GenericCalculatorError("수도권 1,310존 접근강도 O/D는 2023 목적 5종 합계만 지원합니다")
            access_zone_system = "metro-2024-1310"
            target_access_zone = int(target["taz"])
            matrix = self.metro_matrix
            selected_matrix_integrity = {
                **self.metro_matrix_integrity,
                "cache_status": "PINNED_VERIFIED_IN_MEMORY_BYTES",
                "used_at_utc": datetime.now(timezone.utc).isoformat(),
            }
            zones = self.zones
            zone_count = ZONE_COUNT
            zone_id_field = "taz"
            source = self.manifest["sources"]["purpose_od"]
            source_hash = selected_matrix_integrity["sha256"]
            scope = "수도권 내부 일반 접근강도" if is_metro_internal else "수도권 연계 통행만을 대상으로 한 제한 분석"
            scope_status = "GENERAL_SUPPORTED" if is_metro_internal else "LIMITED_CAPITAL_LINKAGE_ONLY"
        elif access_dataset == "national_250_purpose_total":
            if int(od_year) not in NATIONAL_YEARS:
                raise GenericCalculatorError(f"전국 250존 O/D는 제공된 시나리오 연도만 지원합니다: {list(NATIONAL_YEARS)}")
            access_zone_system = "national-2024-250"
            target_access_zone = int(mapping["national_region"]["zone_250"])
            matrix, selected_matrix_integrity = self._national_matrix(int(od_year))
            zones = self.national_zones
            zone_count = 250
            zone_id_field = "zone_250"
            source = {
                **self.manifest["sources"]["national_purpose_bundle"],
                "scenario_year": int(od_year),
                "categories": ["출근", "등교", "업무", "귀가", "기타"],
                "unit": "여객통행/일 (평일 평균 O/D; AAWDT)",
                "orientation": "row origin national-250 zone to column destination national-250 zone",
            }
            source_hash = selected_matrix_integrity["sha256"]
            scope = "전국 시군구 250존 일반 접근강도"
            scope_status = "GENERAL_SUPPORTED_COARSE_RESOLUTION"
        else:
            raise GenericCalculatorError(f"지원하지 않는 접근강도 자료 선택입니다: {access_dataset}")
        rows = self._direction_rows(
            target_access_zone, float(latitude), float(longitude), zones=zones,
            matrix=matrix, zone_count=zone_count, zone_id_field=zone_id_field,
        )
        access = self.aggregate(rows, target_access_zone)
        access["dataset"] = access_dataset
        access["zone_system"] = access_zone_system
        access["scenario_year"] = int(od_year)
        access["selection"] = "목적 5종 합계"
        access["unit"] = "여객통행/일 (평일 평균 O/D; AAWDT)"
        access["scope"] = scope
        access["scope_status"] = scope_status
        access["resolution_warning"] = "시군구급 250존으로 수도권 1,310존보다 공간 해상도가 낮음" if zone_count == 250 else None
        calculation_zone_row = next(row for row in zones if int(row[zone_id_field]) == target_access_zone)
        location_zone = {
            "role": "LOCATION_DETERMINATION_REFERENCE",
            "zone_system": "metro-2024-1310",
            "data_version": "2024 수도권 1,310존 / 경계 " + target["boundary_version_used"],
            "zone_id": int(target["taz"]),
            "region_name": target["zone"]["region_name"],
            "resolution": target["resolution"],
            "determination_status": target["status"],
            "basis": target["basis"],
        }
        calculation_zone = {
            "role": "OD_CALCULATION_TARGET_AND_INTERNAL_ZONE",
            "zone_system": access_zone_system,
            "data_version": "2024 수도권 1,310존" if zone_count == ZONE_COUNT else "2024 전국 250존",
            "zone_id": target_access_zone,
            "region_name": calculation_zone_row["region_name"],
            "resolution": target["resolution"] if zone_count == ZONE_COUNT else "시군구 집계존",
        }
        access["calculation_zone"] = calculation_zone
        access["interpretation_limit"] = (
            "사업지가 속한 시군구 존과 다른 존 사이의 통행을 방향별로 집계합니다. "
            "같은 존 내부 통행은 현재 외부 접근강도 분모에서 제외됩니다."
            if zone_count == 250 else
            "사업지가 속한 수도권 세부 존과 다른 존 사이의 통행을 지리적 방향별로 집계하며, 같은 존 내부통행은 외부 분모에서 제외됩니다."
        )
        calculation_status = "CALCULATED" if access["status"] == "COMPLETE" and indicator["status"] == "CALCULATED" else "CALCULATED_WITH_LIMITATIONS"
        resolved_address = address_resolution or {
            "status": "MANUAL_COORDINATE_ADDRESS_UNVERIFIED",
            "input_address": address,
            "coordinate_source": "user supplied WGS84",
            "administrative_codes": None,
        }
        address_verified = str(resolved_address.get("status", "")).startswith("KAKAO_GEOCODED")
        return {
            "schema_version": 2,
            "session_id": str(uuid.uuid4()),
            "status": (
                "CALCULATED" if calculation_status == "CALCULATED" and address_verified
                else "CALCULATED_ADDRESS_UNVERIFIED" if calculation_status == "CALCULATED"
                else "CALCULATED_WITH_LIMITATIONS" if address_verified
                else "CALCULATED_WITH_LIMITATIONS_ADDRESS_UNVERIFIED"
            ),
            "calculation_status": calculation_status,
            "verification_status": "NOT_INDEPENDENTLY_REVIEWED_THIS_RUN",
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "input": {"address": address, "target_year": int(target_year), "latitude": float(latitude), "longitude": float(longitude), "od_year": int(od_year), "access_dataset": access_dataset},
            "address_resolution": resolved_address,
            "target": {**target, "role": "LOCATION_DETERMINATION_REFERENCE", "zone_system": "metro-2024-1310"},
            "location_zone": location_zone,
            "calculation_zone": calculation_zone,
            "indicator": indicator,
            "access": access,
            "direction_basis": {
                "method": "GEOGRAPHIC_INITIAL_BEARING",
                "north": "315° 이상 또는 45° 미만",
                "east": "45° 이상 135° 미만",
                "south": "135° 이상 225° 미만",
                "west": "225° 이상 315° 미만",
                "warning": "지리적 방향 기준이며 실제 접근도로·경로 분석 결과가 아님",
            },
            "od_source": {**source, "selected_matrix_integrity": selected_matrix_integrity},
            "zone_source": self.manifest["sources"]["zone_workbook"],
            "coordinate_source": self.manifest["sources"]["boundary"],
            "data_manifest": {
                "schema_version": self.manifest["schema_version"],
                "runtime_data_profile": self.runtime_data_profile,
                "integrity_status": "VERIFIED_CLOUD_DERIVED_FILES_AND_EXACT_SELECTED_MATRIX_BYTES",
                "initialization_verified_at_utc": self.integrity_verified_at_utc,
                "selected_matrix": selected_matrix_integrity,
                "source_provenance": self.manifest["sources"],
                "derived": self.manifest["derived"],
            },
            "rows": rows,
            "override_contract": {
                "contract_schema_version": 2,
                "calculation_zone_system": access_zone_system,
                "calculation_zone_id": target_access_zone,
                "location_zone_system": "metro-2024-1310",
                "location_zone_id": int(target["taz"]),
                # Deprecated aliases kept only for explicit schema-1 assignment validation.
                "zone_system": access_zone_system,
                "target_taz": target_access_zone,
                "latitude": float(latitude),
                "longitude": float(longitude),
                "od_source_sha256": source_hash,
                "od_scenario_year": int(od_year),
                "access_dataset": access_dataset,
                "boundary_version": target["boundary_version_used"],
                "representative_point_version": (
                    {
                        "version": self.national_zones_payload["coordinate_source"]["version"],
                        "sha256": self.national_zones_payload["coordinate_source"]["sha256"],
                    }
                    if zone_count == 250
                    else {
                        "primary_version": self.zone_payload["coordinate_source"]["primary_version"],
                        "primary_sha256": self.zone_payload["coordinate_source"]["primary_sha256"],
                        "fallback_version": self.zone_payload["coordinate_source"]["fallback_version"],
                        "fallback_sha256": self.zone_payload["coordinate_source"]["fallback_sha256"],
                    }
                ),
                "direction_rule_version": DIRECTION_RULE_VERSION,
            },
        }

    def reassign(self, result: dict[str, Any], changes: dict[str, str]) -> dict[str, Any]:
        updated = deepcopy(result)
        by_taz = {str(row["taz"]): row for row in updated["rows"]}
        unknown = sorted(set(changes) - set(by_taz))
        if unknown:
            raise GenericCalculatorError(f"원자료에 없는 TAZ 변경값입니다: {unknown[:10]}")
        for raw_taz, assignment in changes.items():
            row = by_taz[raw_taz]
            if int(raw_taz) == int(updated["override_contract"]["target_taz"]):
                if assignment not in {"auto", "internal"}:
                    raise GenericCalculatorError("대상 TAZ 내부통행은 방향 배정하거나 제외할 수 없습니다")
                continue
            if assignment not in VALID_ASSIGNMENTS:
                raise GenericCalculatorError(f"TAZ {raw_taz}의 방향값이 잘못되었습니다: {assignment}")
            if assignment == "auto":
                row["current_direction"] = row["default_direction"]
                row["assignment_source"] = "AUTO_GEOGRAPHIC_BEARING" if row["default_direction"] else "UNASSIGNED_MISSING_COORDINATE"
            else:
                row["current_direction"] = assignment
                row["assignment_source"] = "USER_EXCLUDED" if assignment == "excluded" else "USER_OVERRIDE"
        updated["access"] = self.aggregate(updated["rows"], updated["override_contract"]["target_taz"])
        for key in ("dataset", "zone_system", "scenario_year", "selection", "unit", "scope", "scope_status", "resolution_warning", "interpretation_limit", "calculation_zone"):
            if key in result["access"]:
                updated["access"][key] = result["access"][key]
        updated["calculation_status"] = "CALCULATED" if updated["access"]["status"] == "COMPLETE" and updated["indicator"]["status"] == "CALCULATED" else "CALCULATED_WITH_LIMITATIONS"
        verified = str(updated["address_resolution"].get("status", "")).startswith("KAKAO_GEOCODED")
        updated["status"] = (
            "CALCULATED" if updated["calculation_status"] == "CALCULATED" and verified
            else "CALCULATED_ADDRESS_UNVERIFIED" if updated["calculation_status"] == "CALCULATED"
            else "CALCULATED_WITH_LIMITATIONS" if verified
            else "CALCULATED_WITH_LIMITATIONS_ADDRESS_UNVERIFIED"
        )
        updated["verification_status"] = "NOT_INDEPENDENTLY_REVIEWED_THIS_RUN"
        updated["updated_at_utc"] = datetime.now(timezone.utc).isoformat()
        return updated

    def save_assignment(self, result: dict[str, Any], name: str | None = None) -> Path:
        payload = {
            "schema_version": 2,
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "contract": result["override_contract"],
            "input_address": result["input"]["address"],
            "changes": {
                str(row["taz"]): row["current_direction"]
                for row in result["rows"]
                if row["current_direction"] not in {row["default_direction"], "internal"}
            },
        }
        safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in (name or "direction_assignment"))[:80]
        path = _unique_path(ASSIGNMENT_DIR, safe or "direction_assignment", ".json")
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return path

    def load_assignment(self, result: dict[str, Any], path: Path) -> dict[str, Any]:
        payload = json.loads(path.read_text(encoding="utf-8"))
        expected, actual = result["override_contract"], payload.get("contract")
        schema_version = int(payload.get("schema_version", 1))
        compatibility_mode = "CURRENT_SCHEMA_2"
        if schema_version == 1:
            required_legacy = {"zone_system", "target_taz", "latitude", "longitude", "od_source_sha256", "od_scenario_year", "access_dataset"}
            allowed_legacy = required_legacy | {"boundary_version", "representative_point_version", "direction_rule_version"}
            if not isinstance(actual, dict) or not required_legacy.issubset(actual) or not set(actual).issubset(allowed_legacy):
                raise GenericCalculatorError("구버전 저장 배정 계약을 안전하게 해석할 수 없습니다")
            legacy_source_hashes = {expected.get("od_source_sha256")}
            if expected.get("access_dataset") in {METRO_DATASET, METRO_LIMITED_DATASET}:
                legacy_source_hashes.add(self.manifest["sources"]["purpose_od"]["source_sha256"])
            elif expected.get("access_dataset") == "national_250_purpose_total":
                legacy_source_hashes.add(self.manifest["sources"]["national_purpose_bundle"]["sha256"])
            compatible = all(
                value in legacy_source_hashes if key == "od_source_sha256" else value == expected.get(key)
                for key, value in actual.items()
            )
            compatibility_mode = "LEGACY_SCHEMA_1_EXPLICITLY_VALIDATED"
        elif schema_version == 2:
            compatible = actual == expected
        else:
            raise GenericCalculatorError(f"지원하지 않는 저장 배정 스키마입니다: {schema_version}")
        if not compatible:
            raise GenericCalculatorError("저장 배정의 사업지 위치·대상 TAZ·존 체계·O/D 원본이 현재 계산과 다릅니다")
        baseline = deepcopy(result)
        for row in baseline["rows"]:
            row["current_direction"] = row["default_direction"]
            if row["default_direction"] == "internal":
                row["assignment_source"] = "INTERNAL"
            elif row["default_direction"] is None:
                row["assignment_source"] = "UNASSIGNED_MISSING_COORDINATE"
            else:
                row["assignment_source"] = "AUTO_GEOGRAPHIC_BEARING"
        loaded = self.reassign(baseline, payload.get("changes") or {})
        loaded["assignment_load"] = {"status": "LOADED", "compatibility_mode": compatibility_mode, "source_schema_version": schema_version}
        return loaded

    def export_result(self, result: dict[str, Any], stem: str | None = None) -> dict[str, str]:
        safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in (stem or "indicator_od_result"))[:80]
        json_path = _unique_path(OUTPUT_DIR, safe or "indicator_od_result", ".json")
        csv_path = json_path.with_suffix(".csv")
        json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
            fieldnames = [
                "calculation_zone_system", "calculation_zone_id", "calculation_zone_region_name",
                "location_zone_system", "location_zone_id", "location_zone_region_name",
                "zone_id", "region_name", "default_direction", "current_direction",
                "assignment_source", "bearing_degrees", "inflow_to_target", "outflow_from_target",
            ]
            writer = csv.DictWriter(stream, fieldnames=fieldnames)
            writer.writeheader()
            common = {
                "calculation_zone_system": result["calculation_zone"]["zone_system"],
                "calculation_zone_id": result["calculation_zone"]["zone_id"],
                "calculation_zone_region_name": result["calculation_zone"]["region_name"],
                "location_zone_system": result["location_zone"]["zone_system"],
                "location_zone_id": result["location_zone"]["zone_id"],
                "location_zone_region_name": result["location_zone"]["region_name"],
            }
            writer.writerows({**common, "zone_id": row.get("taz"), **{key: row.get(key) for key in fieldnames if key not in common and key != "zone_id"}} for row in result["rows"])
        return {"json": str(json_path), "csv": str(csv_path)}


def list_assignment_files() -> list[dict[str, Any]]:
    ASSIGNMENT_DIR.mkdir(parents=True, exist_ok=True)
    return [
        {"name": path.name, "path": str(path), "modified_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()}
        for path in sorted(ASSIGNMENT_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    ]


def safe_assignment_path(name: str) -> Path:
    path = (ASSIGNMENT_DIR / name).resolve()
    if path.parent != ASSIGNMENT_DIR.resolve() or path.suffix.lower() != ".json" or not path.is_file():
        raise GenericCalculatorError("허용된 저장 방향 파일이 아닙니다")
    return path
