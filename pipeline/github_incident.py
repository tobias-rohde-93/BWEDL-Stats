from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from typing import Any


INCIDENT_LABEL = "automated-scraper-failure"
INCIDENT_TITLE = "Automated scraper failed in consecutive scheduled runs"
INCIDENT_DESCRIPTION = "Repeated failures in the scheduled data update"
WORKFLOW_FILE = "update.yml"
COMPLETED_CONCLUSIONS = {
    "action_required",
    "cancelled",
    "failure",
    "neutral",
    "skipped",
    "stale",
    "startup_failure",
    "success",
    "timed_out",
}
Runner = Callable[..., subprocess.CompletedProcess[str]]


class IncidentAutomationError(Exception):
    pass


def _reject_json_constant(value: str) -> Any:
    raise IncidentAutomationError("invalid JSON constant")


def _gh_json(command: list[str], runner: Runner) -> Any:
    try:
        result = runner(
            command,
            capture_output=True,
            text=True,
            check=True,
        )
        return json.loads(result.stdout, parse_constant=_reject_json_constant)
    except (OSError, subprocess.SubprocessError, UnicodeError, json.JSONDecodeError) as error:
        raise IncidentAutomationError("GitHub command failed") from error


def _gh(command: list[str], runner: Runner) -> None:
    try:
        runner(command, capture_output=True, text=True, check=True)
    except (OSError, subprocess.SubprocessError) as error:
        raise IncidentAutomationError("GitHub command failed") from error


def _single_previous_run(repository: str, runner: Runner) -> dict[str, Any] | None:
    value = _gh_json(
        [
            "gh", "run", "list",
            "--repo", repository,
            "--workflow", WORKFLOW_FILE,
            "--event", "schedule",
            "--status", "completed",
            "--limit", "1",
            "--json", "conclusion,databaseId,url",
        ],
        runner,
    )
    if not isinstance(value, list) or len(value) > 1:
        raise IncidentAutomationError("unexpected run response")
    if not value:
        return None
    run = value[0]
    if not isinstance(run, dict) or set(run) != {"conclusion", "databaseId", "url"}:
        raise IncidentAutomationError("unexpected run response")
    if run["conclusion"] not in COMPLETED_CONCLUSIONS:
        raise IncidentAutomationError("unexpected run conclusion")
    if (
        isinstance(run["databaseId"], bool)
        or not isinstance(run["databaseId"], int)
        or run["databaseId"] <= 0
        or not isinstance(run["url"], str)
        or not run["url"].strip()
    ):
        raise IncidentAutomationError("unexpected run response")
    return run


def _open_incident(repository: str, runner: Runner) -> int | None:
    value = _gh_json(
        [
            "gh", "issue", "list",
            "--repo", repository,
            "--state", "open",
            "--label", INCIDENT_LABEL,
            "--limit", "1",
            "--json", "number",
        ],
        runner,
    )
    if not isinstance(value, list) or len(value) > 1:
        raise IncidentAutomationError("unexpected issue response")
    if not value:
        return None
    issue = value[0]
    if not isinstance(issue, dict) or set(issue) != {"number"}:
        raise IncidentAutomationError("unexpected issue response")
    number = issue["number"]
    if isinstance(number, bool) or not isinstance(number, int) or number <= 0:
        raise IncidentAutomationError("unexpected issue number")
    return number


def _ensure_incident_label(repository: str, runner: Runner) -> None:
    _gh(
        [
            "gh", "label", "create", INCIDENT_LABEL,
            "--color", "D73A4A",
            "--description", INCIDENT_DESCRIPTION,
            "--force",
            "--repo", repository,
        ],
        runner,
    )


def _record_failure(repository: str, run_url: str, runner: Runner) -> None:
    previous = _single_previous_run(repository, runner)
    if previous is None or previous["conclusion"] != "failure":
        return

    _ensure_incident_label(repository, runner)
    issue_number = _open_incident(repository, runner)
    body = f"A scheduled data update failed again. Run: {run_url}"
    if issue_number is None:
        _gh(
            [
                "gh", "issue", "create",
                "--repo", repository,
                "--title", INCIDENT_TITLE,
                "--label", INCIDENT_LABEL,
                "--body", body,
            ],
            runner,
        )
    else:
        _gh(
            [
                "gh", "issue", "comment", str(issue_number),
                "--repo", repository,
                "--body", body,
            ],
            runner,
        )


def _record_recovery(repository: str, run_url: str, runner: Runner) -> None:
    issue_number = _open_incident(repository, runner)
    if issue_number is None:
        return
    _gh(
        [
            "gh", "issue", "comment", str(issue_number),
            "--repo", repository,
            "--body", f"Scheduled data updates recovered. Run: {run_url}",
        ],
        runner,
    )
    _gh(
        ["gh", "issue", "close", str(issue_number), "--repo", repository],
        runner,
    )


def run(
    mode: str,
    *,
    runner: Runner = subprocess.run,
    environ: Mapping[str, str] = os.environ,
) -> int:
    try:
        if mode not in {"failure", "recovery"}:
            raise IncidentAutomationError("unsupported mode")
        required = ("GITHUB_REPOSITORY", "GITHUB_RUN_URL", "GH_TOKEN")
        if any(not environ.get(name, "").strip() for name in required):
            raise IncidentAutomationError("missing environment")
        repository = environ["GITHUB_REPOSITORY"]
        run_url = environ["GITHUB_RUN_URL"]
        if mode == "failure":
            _record_failure(repository, run_url, runner)
        else:
            _record_recovery(repository, run_url, runner)
    except (IncidentAutomationError, TypeError, ValueError):
        print("error: GitHub incident automation failed", file=sys.stderr)
        return 1
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Manage scheduled scraper incidents")
    parser.add_argument("mode", choices=("failure", "recovery"))
    arguments = parser.parse_args(argv)
    return run(arguments.mode)


if __name__ == "__main__":
    raise SystemExit(main())
