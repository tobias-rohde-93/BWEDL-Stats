from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pipeline.validation import Decision, ValidationResult


DOMAIN_ORDER = ("leagues", "rankings", "clubs", "archives")
DECISIONS = {decision.value for decision in Decision}
REQUIRED_REPORT_FIELDS = {
    "started_at",
    "finished_at",
    "duration_seconds",
    "success",
    "domains",
    "published_files",
}
REQUIRED_DOMAIN_FIELDS = {
    "domain",
    "decision",
    "effective_season",
    "reasons",
    "metrics",
}


def _reject_json_constant(constant: str) -> Any:
    raise ValueError(f"non-standard JSON constant: {constant}")


def _aware_timestamp(value: Any, field_name: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be an ISO timestamp string")
    try:
        timestamp = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{field_name} must be an ISO timestamp string") from error
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return timestamp


def validate_report_schema(report: dict[str, Any]) -> None:
    if not isinstance(report, dict):
        raise ValueError("report root must be an object")
    missing_fields = REQUIRED_REPORT_FIELDS - report.keys()
    if missing_fields:
        raise ValueError("report is missing required fields")

    started_at = _aware_timestamp(report["started_at"], "started_at")
    finished_at = _aware_timestamp(report["finished_at"], "finished_at")
    if finished_at < started_at:
        raise ValueError("report chronology is reversed")

    duration = report["duration_seconds"]
    if (
        isinstance(duration, bool)
        or not isinstance(duration, (int, float))
        or not math.isfinite(duration)
        or duration < 0
    ):
        raise ValueError("duration_seconds must be a non-negative number")
    expected_duration = (finished_at - started_at).total_seconds()
    if not math.isclose(duration, expected_duration, rel_tol=0.0, abs_tol=1e-9):
        raise ValueError("duration_seconds does not match report timestamps")

    if not isinstance(report["success"], bool):
        raise ValueError("success must be a boolean")
    domains = report["domains"]
    if not isinstance(domains, list) or not domains:
        raise ValueError("domains must be a nonempty list")
    seen_domains: set[str] = set()
    for item in domains:
        if not isinstance(item, dict) or not REQUIRED_DOMAIN_FIELDS <= item.keys():
            raise ValueError("report contains an incomplete domain item")
        domain = item["domain"]
        if not isinstance(domain, str) or domain not in DOMAIN_ORDER:
            raise ValueError("report contains an unknown domain")
        if domain in seen_domains:
            raise ValueError("report contains a duplicate domain")
        seen_domains.add(domain)
        decision = item["decision"]
        if not isinstance(decision, str) or decision not in DECISIONS:
            raise ValueError("report contains an invalid decision")
        season = item["effective_season"]
        if not isinstance(season, str) or not season.strip():
            raise ValueError("effective_season must be a nonblank string")
        reasons = item["reasons"]
        if not isinstance(reasons, list) or not all(
            isinstance(reason, str) for reason in reasons
        ):
            raise ValueError("reasons must be a list of strings")
        metrics = item["metrics"]
        if not isinstance(metrics, dict) or not all(
            isinstance(name, str)
            and isinstance(value, int)
            and not isinstance(value, bool)
            for name, value in metrics.items()
        ):
            raise ValueError("metrics must map strings to integers")

    published_files = report["published_files"]
    if not isinstance(published_files, list):
        raise ValueError("published_files must be a list")
    seen_filenames: set[str] = set()
    for filename in published_files:
        if (
            not isinstance(filename, str)
            or not filename.strip()
            or filename in {".", ".."}
            or "/" in filename
            or "\\" in filename
            or Path(filename).name != filename
        ):
            raise ValueError("published_files must contain basenames")
        if filename in seen_filenames:
            raise ValueError("published_files contains a duplicate filename")
        seen_filenames.add(filename)


def write_report(
    path: Path,
    results: list[ValidationResult],
    published_files: list[Path],
    started_at: datetime,
    finished_at: datetime,
) -> dict[str, Any]:
    if (
        started_at.tzinfo is None
        or started_at.utcoffset() is None
        or finished_at.tzinfo is None
        or finished_at.utcoffset() is None
    ):
        raise ValueError("report times must be timezone-aware")
    if finished_at < started_at:
        raise ValueError("report chronology is reversed")

    indexed_results: dict[str, ValidationResult] = {}
    for result in results:
        if result.domain not in DOMAIN_ORDER:
            raise ValueError(f"unknown report domain: {result.domain}")
        if result.domain in indexed_results:
            raise ValueError(f"duplicate report domain: {result.domain}")
        indexed_results[result.domain] = result
    ordered_results = [
        indexed_results[domain] for domain in DOMAIN_ORDER if domain in indexed_results
    ]

    report: dict[str, Any] = {
        "started_at": started_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "finished_at": finished_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "duration_seconds": (finished_at - started_at).total_seconds(),
        "success": all(
            result.decision in (Decision.PUBLISH, Decision.RETAIN)
            for result in ordered_results
        ),
        "domains": [result.to_dict() for result in ordered_results],
        "published_files": [published_file.name for published_file in published_files],
    }
    validate_report_schema(report)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return report


def _markdown_cell(value: Any) -> str:
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r", " ")
        .replace("\n", " ")
    )


def render_step_summary(report: dict[str, Any]) -> str:
    validate_report_schema(report)
    domains = report["domains"]
    published_files = report["published_files"]

    lines = [
        "## Data publication summary",
        "",
        f"Success: {'yes' if report.get('success') is True else 'no'}",
        "",
        "| Domain | Decision | Season | Reasons |",
        "| --- | --- | --- | --- |",
    ]
    for domain in domains:
        reasons = domain["reasons"]
        reason_text = "; ".join(_markdown_cell(reason) for reason in reasons) or "—"
        lines.append(
            "| "
            + " | ".join(
                (
                    _markdown_cell(domain["domain"]),
                    _markdown_cell(domain["decision"]),
                    _markdown_cell(domain["effective_season"]),
                    reason_text,
                )
            )
            + " |"
        )

    filenames = ", ".join(_markdown_cell(name) for name in published_files) or "none"
    lines.extend(("", f"Published files: {filenames}"))
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render a publication report summary")
    parser.add_argument("--summary", type=Path, required=True)
    arguments = parser.parse_args(argv)

    try:
        with arguments.summary.open("r", encoding="utf-8", newline="") as report_file:
            report = json.load(report_file, parse_constant=_reject_json_constant)
        if not isinstance(report, dict):
            raise ValueError("report root must be an object")
        summary = render_step_summary(report)
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        print(
            "error: could not read report; it is missing or malformed",
            file=sys.stderr,
        )
        return 1

    print(summary, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
