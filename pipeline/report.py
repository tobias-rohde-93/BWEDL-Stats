from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

from pipeline.validation import Decision, ValidationResult


def _reject_json_constant(constant: str) -> Any:
    raise ValueError(f"non-standard JSON constant: {constant}")


def write_report(
    path: Path,
    results: list[ValidationResult],
    published_files: list[Path],
    started_at: datetime,
    finished_at: datetime,
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "success": all(
            result.decision in (Decision.PUBLISH, Decision.RETAIN)
            for result in results
        ),
        "domains": [result.to_dict() for result in results],
        "published_files": [published_file.name for published_file in published_files],
    }
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
    domains = report.get("domains")
    published_files = report.get("published_files")
    if not isinstance(domains, list) or not isinstance(published_files, list):
        raise ValueError("report is missing required collections")

    lines = [
        "## Data publication summary",
        "",
        f"Success: {'yes' if report.get('success') is True else 'no'}",
        "",
        "| Domain | Decision | Season | Reasons |",
        "| --- | --- | --- | --- |",
    ]
    for domain in domains:
        if not isinstance(domain, dict):
            raise ValueError("report contains an invalid domain entry")
        reasons = domain.get("reasons", [])
        if not isinstance(reasons, list):
            raise ValueError("report contains invalid domain reasons")
        reason_text = "; ".join(_markdown_cell(reason) for reason in reasons) or "—"
        lines.append(
            "| "
            + " | ".join(
                (
                    _markdown_cell(domain.get("domain", "")),
                    _markdown_cell(domain.get("decision", "")),
                    _markdown_cell(domain.get("effective_season", "")),
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
