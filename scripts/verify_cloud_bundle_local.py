from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import uuid
import zipfile
from pathlib import Path


DIRECTIONS = ("north", "east", "south", "west")


def stable_row(row: dict) -> tuple:
    return (
        int(row.get("taz", row.get("zone_250"))),
        row["region_name"],
        row["default_direction"],
        float(row["inflow_to_target"]),
        float(row["outflow_from_target"]),
    )


def independent_default_totals(rows: list[dict]) -> dict[str, dict[str, float]]:
    totals = {direction: {"inflow": 0.0, "outflow": 0.0} for direction in DIRECTIONS}
    for row in rows:
        direction = row.get("default_direction")
        if direction in totals:
            totals[direction]["inflow"] += float(row["inflow_to_target"])
            totals[direction]["outflow"] += float(row["outflow_from_target"])
    return totals


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--core-root", type=Path, required=True)
    parser.add_argument("--expected", type=Path, action="append", required=True)
    parser.add_argument("--work-dir", type=Path, default=Path("cloud_artifacts"))
    args = parser.parse_args()
    checks = []
    args.work_dir.mkdir(parents=True, exist_ok=True)
    root = args.work_dir.resolve() / f"tia-cloud-bundle-{uuid.uuid4().hex}"
    root.mkdir(parents=True, exist_ok=False)
    try:
        with zipfile.ZipFile(args.bundle) as archive:
            archive.extractall(root)
        os.environ["TIA_COMMON_DATA_ROOT"] = str(root)
        import sys

        sys.path.insert(0, str(args.core_root.resolve()))
        from src.generic_calculator import GenericCalculator

        calculator = GenericCalculator()
        for expected_path in args.expected:
            expected = json.loads(expected_path.read_text(encoding="utf-8-sig"))
            item = expected["input"]
            actual = calculator.calculate(
                item["address"], item["target_year"], item["latitude"], item["longitude"],
                item["od_year"], item["access_dataset"], expected.get("address_resolution"),
            )
            if actual["calculation_zone"] != expected["calculation_zone"]:
                raise AssertionError(f"calculation zone mismatch: {expected_path}")
            if actual["location_zone"] != expected["location_zone"]:
                raise AssertionError(f"location zone mismatch: {expected_path}")
            if actual["indicator"] != expected["indicator"]:
                raise AssertionError(f"indicator mismatch: {expected_path}")
            actual_rows = [stable_row(row) for row in actual["rows"]]
            expected_rows = [stable_row(row) for row in expected["rows"]]
            if actual_rows != expected_rows:
                raise AssertionError(f"O/D row mismatch: {expected_path}")
            independent = independent_default_totals(expected["rows"])
            for direction in DIRECTIONS:
                for flow in ("inflow", "outflow"):
                    left = float(actual["access"]["directions"][direction][flow])
                    right = float(independent[direction][flow])
                    if not math.isclose(left, right, rel_tol=0.0, abs_tol=1e-9):
                        raise AssertionError(f"direction total mismatch: {expected_path} {direction} {flow}")
            for flow in ("inflow", "outflow"):
                if not math.isclose(
                    float(actual["access"]["denominators"][flow]),
                    float(expected["access"]["denominators"][flow]),
                    rel_tol=0.0,
                    abs_tol=1e-9,
                ):
                    raise AssertionError(f"denominator mismatch: {expected_path} {flow}")
                if not math.isclose(
                    float(actual["access"]["internal"][flow]),
                    float(expected["access"]["internal"][flow]),
                    rel_tol=0.0,
                    abs_tol=1e-9,
                ):
                    raise AssertionError(f"internal flow mismatch: {expected_path} {flow}")
            checks.append({
                "case": expected_path.stem,
                "calculation_zone": actual["calculation_zone"],
                "location_zone": actual["location_zone"],
                "row_count": len(actual_rows),
                "status": "PASS",
            })
    finally:
        shutil.rmtree(root, ignore_errors=True)
    print(json.dumps({"status": "PASS", "checks": checks}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
