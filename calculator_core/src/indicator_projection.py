from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Mapping


class IndicatorProjectionError(ValueError):
    pass


def _anchor(value: float, policy: str) -> Decimal:
    decimal = Decimal(str(value))
    if policy == "raw_source":
        return decimal
    if policy == "rounded_integer_anchor":
        return decimal.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    raise IndicatorProjectionError(
        "anchor_rounding_policy must be 'raw_source' or 'rounded_integer_anchor'"
    )


def cagr_project_integer(
    start_value: float,
    end_value: float,
    start_year: int,
    end_year: int,
    target_year: int,
    *,
    anchor_rounding_policy: str,
) -> int:
    if not start_year <= target_year <= end_year:
        raise IndicatorProjectionError(
            f"Target year {target_year} is outside verified anchor interval {start_year}..{end_year}"
        )
    start = _anchor(start_value, anchor_rounding_policy)
    end = _anchor(end_value, anchor_rounding_policy)
    if start <= 0 or end < 0 or end_year <= start_year:
        raise IndicatorProjectionError("CAGR projection requires positive anchors and increasing years")
    with localcontext() as context:
        context.prec = 50
        exponent = Decimal(target_year - start_year) / Decimal(end_year - start_year)
        projected = start * ((end / start).ln() * exponent).exp()
        return int(projected.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def cagr_project_decimal(
    start_value: float,
    end_value: float,
    start_year: int,
    end_year: int,
    target_year: int,
    *,
    anchor_rounding_policy: str = "raw_source",
) -> Decimal:
    """Project without display rounding so source precision remains auditable."""
    if not start_year <= target_year <= end_year:
        raise IndicatorProjectionError(
            f"Target year {target_year} is outside verified anchor interval {start_year}..{end_year}"
        )
    start = _anchor(start_value, anchor_rounding_policy)
    end = _anchor(end_value, anchor_rounding_policy)
    if start == 0 and end == 0:
        return Decimal(0)
    if start <= 0 or end <= 0 or end_year <= start_year:
        raise IndicatorProjectionError("CAGR projection requires positive anchors, except 0 to 0")
    with localcontext() as context:
        context.prec = 50
        exponent = Decimal(target_year - start_year) / Decimal(end_year - start_year)
        return start * ((end / start).ln() * exponent).exp()


def project_detail_block(
    start_values: Mapping[str, float],
    end_values: Mapping[str, float],
    start_year: int,
    end_year: int,
    target_year: int,
    *,
    anchor_rounding_policy: str,
) -> dict:
    if set(start_values) != set(end_values):
        raise IndicatorProjectionError("Start/end category sets differ")
    details = {
        key: cagr_project_integer(
            start_values[key],
            end_values[key],
            start_year,
            end_year,
            target_year,
            anchor_rounding_policy=anchor_rounding_policy,
        )
        for key in start_values
    }
    total = sum(details.values())
    shares = {key: (value / total if total else None) for key, value in details.items()}
    return {
        "start_year": start_year,
        "end_year": end_year,
        "target_year": target_year,
        "anchor_rounding_policy": anchor_rounding_policy,
        "details": details,
        "total": total,
        "shares": shares,
        "share_sum": sum(value for value in shares.values() if value is not None),
        "total_policy": "sum of individually projected and integer-rounded category rows",
    }
