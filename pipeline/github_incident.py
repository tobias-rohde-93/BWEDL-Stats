from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


INCIDENT_LABEL = "automated-scraper-failure"
INCIDENT_TITLE = "Automated scraper failed in consecutive scheduled runs"
INCIDENT_DESCRIPTION = "Repeated failures in the scheduled data update"
WORKFLOW_FILE = "update.yml"
UPDATE_JOB = "update-data"
TECHNICAL_FAILURES = {"failure", "timed_out", "startup_failure"}
RESULT_CONCLUSIONS = {
    "success": {"success"},
    "failure": TECHNICAL_FAILURES,
    "cancelled": {"cancelled"},
    "skipped": {"skipped"},
}
SAFE_DOMAINS = ("leagues", "rankings", "clubs", "archives")
Runner = Callable[..., subprocess.CompletedProcess[str]]


class IncidentAutomationError(Exception):
    pass


@dataclass(frozen=True)
class JobInfo:
    database_id: int
    conclusion: str


@dataclass(frozen=True)
class RunInfo:
    database_id: int
    url: str
    created_at: str
    update_job: JobInfo | None = None


def _reject_json_constant(value: str) -> Any:
    raise IncidentAutomationError("invalid JSON constant")


def _gh_json(command: list[str], runner: Runner) -> Any:
    try:
        result = runner(command, capture_output=True, text=True, check=True)
        return json.loads(result.stdout, parse_constant=_reject_json_constant)
    except (OSError, subprocess.SubprocessError, UnicodeError, json.JSONDecodeError) as error:
        raise IncidentAutomationError("GitHub command failed") from error


def _gh(command: list[str], runner: Runner) -> None:
    try:
        runner(command, capture_output=True, text=True, check=True)
    except (OSError, subprocess.SubprocessError) as error:
        raise IncidentAutomationError("GitHub command failed") from error


def _positive_integer(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise IncidentAutomationError("invalid identifier")
    return value


def _timestamp(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 64:
        raise IncidentAutomationError("invalid timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise IncidentAutomationError("invalid timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise IncidentAutomationError("invalid timestamp")
    return value


def _url(value: Any) -> str:
    if (
        not isinstance(value, str)
        or len(value) > 500
        or not value.startswith(("https://github.com/", "https://github.example/"))
    ):
        raise IncidentAutomationError("invalid run URL")
    return value


def _update_job(value: Any) -> JobInfo:
    if not isinstance(value, list):
        raise IncidentAutomationError("invalid jobs response")
    matches = [job for job in value if isinstance(job, dict) and job.get("name") == UPDATE_JOB]
    if len(matches) != 1:
        raise IncidentAutomationError("missing or duplicate update job")
    job = matches[0]
    if not {"name", "databaseId", "conclusion"} <= job.keys():
        raise IncidentAutomationError("invalid update job")
    conclusion = job["conclusion"]
    if not isinstance(conclusion, str) or conclusion not in set().union(*RESULT_CONCLUSIONS.values()):
        raise IncidentAutomationError("invalid update job conclusion")
    return JobInfo(_positive_integer(job["databaseId"]), conclusion)


def _current_run(repository: str, run_id: int, runner: Runner) -> RunInfo:
    value = _gh_json(
        [
            "gh", "run", "view", str(run_id),
            "--repo", repository,
            "--json", "createdAt,url,databaseId,jobs",
        ],
        runner,
    )
    if not isinstance(value, dict) or set(value) != {"createdAt", "url", "databaseId", "jobs"}:
        raise IncidentAutomationError("invalid current run response")
    if _positive_integer(value["databaseId"]) != run_id:
        raise IncidentAutomationError("current run ID mismatch")
    return RunInfo(
        run_id,
        _url(value["url"]),
        _timestamp(value["createdAt"]),
        _update_job(value["jobs"]),
    )


def _previous_run(repository: str, runner: Runner) -> RunInfo | None:
    value = _gh_json(
        [
            "gh", "run", "list",
            "--repo", repository,
            "--workflow", WORKFLOW_FILE,
            "--event", "schedule",
            "--status", "completed",
            "--limit", "1",
            "--json", "createdAt,databaseId,url",
        ],
        runner,
    )
    if not isinstance(value, list) or len(value) > 1:
        raise IncidentAutomationError("invalid previous run response")
    if not value:
        return None
    item = value[0]
    if not isinstance(item, dict) or set(item) != {"createdAt", "databaseId", "url"}:
        raise IncidentAutomationError("invalid previous run response")
    run_id = _positive_integer(item["databaseId"])
    jobs = _gh_json(
        ["gh", "run", "view", str(run_id), "--repo", repository, "--json", "jobs"],
        runner,
    )
    if not isinstance(jobs, dict) or set(jobs) != {"jobs"}:
        raise IncidentAutomationError("invalid previous jobs response")
    return RunInfo(
        run_id,
        _url(item["url"]),
        _timestamp(item["createdAt"]),
        _update_job(jobs["jobs"]),
    )


def _open_incident(repository: str, runner: Runner) -> int | None:
    value = _gh_json(
        [
            "gh", "issue", "list", "--repo", repository, "--state", "open",
            "--label", INCIDENT_LABEL, "--limit", "1", "--json", "number",
        ],
        runner,
    )
    if not isinstance(value, list) or len(value) > 1:
        raise IncidentAutomationError("invalid issue response")
    if not value:
        return None
    if not isinstance(value[0], dict) or set(value[0]) != {"number"}:
        raise IncidentAutomationError("invalid issue response")
    return _positive_integer(value[0]["number"])


def _ensure_label(repository: str, runner: Runner) -> None:
    _gh(
        [
            "gh", "label", "create", INCIDENT_LABEL,
            "--color", "D73A4A", "--description", INCIDENT_DESCRIPTION,
            "--force", "--repo", repository,
        ],
        runner,
    )


def _affected_domains(report_path: str | None) -> str:
    if not report_path:
        return "unknown"
    try:
        value = json.loads(Path(report_path).read_text(encoding="utf-8"), parse_constant=_reject_json_constant)
        domains = value["domains"]
        if not isinstance(domains, list):
            return "unknown"
        affected = [
            domain
            for domain in SAFE_DOMAINS
            if any(
                isinstance(item, dict)
                and item.get("domain") == domain
                and item.get("decision") in {"blocked", "failed"}
                for item in domains
            )
        ]
        return ", ".join(affected) if affected else "none reported"
    except (OSError, UnicodeError, json.JSONDecodeError, IncidentAutomationError, KeyError, TypeError):
        return "unknown"


def _incident_body(current: RunInfo, previous: RunInfo, result: str, report_path: str | None) -> str:
    assert current.update_job is not None
    return "\n".join(
        (
            "Automated scheduled data update incident",
            f"- Previous workflow: {previous.url}",
            f"- Previous timestamp: {previous.created_at}",
            f"- Current workflow: {current.url}",
            f"- Current timestamp: {current.created_at}",
            f"- Current update result: {result} ({current.update_job.conclusion})",
            f"- Affected domains: {_affected_domains(report_path)}",
            "- Consecutive failures: at least 2",
        )
    )[:1500]


def _record_failure(
    repository: str,
    current: RunInfo,
    result: str,
    report_path: str | None,
    runner: Runner,
) -> None:
    previous = _previous_run(repository, runner)
    if previous is None or previous.update_job is None:
        return
    if previous.update_job.conclusion not in TECHNICAL_FAILURES:
        return
    _ensure_label(repository, runner)
    issue_number = _open_incident(repository, runner)
    body = _incident_body(current, previous, result, report_path)
    if issue_number is None:
        _gh(
            [
                "gh", "issue", "create", "--repo", repository,
                "--title", INCIDENT_TITLE, "--label", INCIDENT_LABEL, "--body", body,
            ],
            runner,
        )
    else:
        _gh(
            ["gh", "issue", "comment", str(issue_number), "--repo", repository, "--body", body],
            runner,
        )


def _record_recovery(repository: str, current: RunInfo, runner: Runner) -> None:
    issue_number = _open_incident(repository, runner)
    if issue_number is None:
        return
    body = f"Scheduled data updates recovered. Run: {current.url}\nTimestamp: {current.created_at}"
    _gh(
        ["gh", "issue", "comment", str(issue_number), "--repo", repository, "--body", body],
        runner,
    )
    _gh(["gh", "issue", "close", str(issue_number), "--repo", repository], runner)


def run(
    mode: str,
    *,
    runner: Runner = subprocess.run,
    environ: Mapping[str, str] = os.environ,
) -> int:
    try:
        if mode != "notify":
            raise IncidentAutomationError("unsupported mode")
        required = ("GITHUB_REPOSITORY", "GITHUB_RUN_ID", "CURRENT_UPDATE_RESULT", "GH_TOKEN")
        if any(not environ.get(name, "").strip() for name in required):
            raise IncidentAutomationError("missing environment")
        repository = environ["GITHUB_REPOSITORY"]
        result = environ["CURRENT_UPDATE_RESULT"]
        if result not in RESULT_CONCLUSIONS:
            raise IncidentAutomationError("invalid update result")
        run_id_text = environ["GITHUB_RUN_ID"]
        if not run_id_text.isascii() or not run_id_text.isdecimal():
            raise IncidentAutomationError("invalid run ID")
        current = _current_run(repository, int(run_id_text), runner)
        assert current.update_job is not None
        if current.update_job.conclusion not in RESULT_CONCLUSIONS[result]:
            raise IncidentAutomationError("update result mismatch")
        if result == "success":
            _record_recovery(repository, current, runner)
        elif result == "failure":
            _record_failure(repository, current, result, environ.get("REPORT_PATH"), runner)
    except (IncidentAutomationError, TypeError, ValueError):
        print("error: GitHub incident automation failed", file=sys.stderr)
        return 1
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Manage scheduled scraper incidents")
    parser.add_argument("mode", choices=("notify",))
    arguments = parser.parse_args(argv)
    return run(arguments.mode)


if __name__ == "__main__":
    raise SystemExit(main())
