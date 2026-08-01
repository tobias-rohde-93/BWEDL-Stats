from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from pipeline import github_incident


ENV = {
    "GITHUB_REPOSITORY": "owner/repository",
    "GITHUB_RUN_ID": "42",
    "CURRENT_UPDATE_RESULT": "failure",
    "GH_TOKEN": "test-token",
}


def run_payload(
    run_id: int,
    conclusion: str,
    *,
    url: str | None = None,
    created_at: str | None = None,
) -> str:
    return json.dumps(
        {
            "createdAt": created_at or f"2026-08-01T0{run_id % 10}:00:00Z",
            "databaseId": run_id,
            "url": url or f"https://github.example/runs/{run_id}",
            "jobs": [
                {
                    "name": "update-data",
                    "databaseId": run_id * 10,
                    "conclusion": conclusion,
                }
            ],
        }
    )


def previous_list_payload() -> str:
    return json.dumps(
        [
            {
                "createdAt": "2026-08-01T01:00:00Z",
                "databaseId": 41,
                "url": "https://github.example/runs/41",
            }
        ]
    )


def jobs_payload(conclusion: str) -> str:
    return json.dumps(
        {
            "jobs": [
                {
                    "name": "update-data",
                    "databaseId": 410,
                    "conclusion": conclusion,
                }
            ]
        }
    )


class FakeRunner:
    def __init__(self, outputs: list[str]):
        self.outputs = iter(outputs)
        self.commands: list[list[str]] = []
        self.kwargs: list[dict[str, object]] = []

    def __call__(self, command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        self.kwargs.append(kwargs)
        return subprocess.CompletedProcess(command, 0, next(self.outputs), "")


def test_cancelled_update_is_not_a_strike_or_recovery():
    runner = FakeRunner([run_payload(42, "cancelled")])
    environ = {**ENV, "CURRENT_UPDATE_RESULT": "cancelled"}

    assert github_incident.run("notify", runner=runner, environ=environ) == 0

    assert len(runner.commands) == 1
    assert runner.commands[0][:4] == ["gh", "run", "view", "42"]


def test_successful_update_comments_and_closes_open_incident():
    runner = FakeRunner(
        [run_payload(42, "success"), '[{"number":7}]', "commented\n", "closed\n"]
    )
    environ = {**ENV, "CURRENT_UPDATE_RESULT": "success"}

    assert github_incident.run("notify", runner=runner, environ=environ) == 0

    assert runner.commands[-2][:4] == ["gh", "issue", "comment", "7"]
    assert "https://github.example/runs/42" in runner.commands[-2][-1]
    assert runner.commands[-1][:4] == ["gh", "issue", "close", "7"]


def test_previous_notification_only_failure_is_not_a_second_update_strike():
    runner = FakeRunner(
        [run_payload(42, "failure"), previous_list_payload(), jobs_payload("success")]
    )

    assert github_incident.run("notify", runner=runner, environ=ENV) == 0

    assert len(runner.commands) == 3
    assert runner.commands[1][:4] == ["gh", "run", "list", "--repo"]
    assert runner.commands[2][:4] == ["gh", "run", "view", "41"]
    assert all(command[:2] != ["gh", "issue"] for command in runner.commands)


def test_second_update_failure_opens_incident_with_sanitized_context(tmp_path: Path):
    report = tmp_path / "update_report.json"
    report.write_text(
        json.dumps(
            {
                "domains": [
                    {"domain": "rankings", "decision": "failed", "reasons": ["token=secret"]},
                    {"domain": "clubs", "decision": "publish", "reasons": []},
                    {"domain": "<script>secret</script>", "decision": "blocked", "reasons": []},
                ]
            }
        ),
        encoding="utf-8",
    )
    runner = FakeRunner(
        [
            run_payload(42, "timed_out", created_at="2026-08-01T02:00:00Z"),
            previous_list_payload(),
            jobs_payload("failure"),
            "label ensured\n",
            "[]",
            "created\n",
        ]
    )
    environ = {**ENV, "REPORT_PATH": str(report)}

    assert github_incident.run("notify", runner=runner, environ=environ) == 0

    assert runner.commands[2] == [
        "gh", "run", "view", "41", "--repo", "owner/repository", "--json", "jobs"
    ]
    assert runner.commands[3][:4] == ["gh", "label", "create", "automated-scraper-failure"]
    create = runner.commands[-1]
    assert create[:3] == ["gh", "issue", "create"]
    body = create[create.index("--body") + 1]
    for expected in (
        "https://github.example/runs/41",
        "https://github.example/runs/42",
        "2026-08-01T01:00:00Z",
        "2026-08-01T02:00:00Z",
        "Current update result: failure (timed_out)",
        "Affected domains: rankings",
        "Consecutive failures: at least 2",
    ):
        assert expected in body
    assert "secret" not in body
    assert "reasons" not in body.lower()
    assert len(body) <= 1500
    assert all(call.get("shell") is not True for call in runner.kwargs)


def test_repeated_failure_comments_on_existing_incident():
    runner = FakeRunner(
        [
            run_payload(42, "failure"),
            previous_list_payload(),
            jobs_payload("startup_failure"),
            "label ensured\n",
            '[{"number":7}]',
            "commented\n",
        ]
    )

    assert github_incident.run("notify", runner=runner, environ=ENV) == 0

    assert runner.commands[-1][:4] == ["gh", "issue", "comment", "7"]
    assert "Consecutive failures: at least 2" in runner.commands[-1][-1]


def test_missing_report_is_reported_as_unknown_without_blocking_incident(tmp_path: Path):
    runner = FakeRunner(
        [
            run_payload(42, "failure"),
            previous_list_payload(),
            jobs_payload("failure"),
            "label ensured\n",
            "[]",
            "created\n",
        ]
    )
    environ = {**ENV, "REPORT_PATH": str(tmp_path / "missing.json")}

    assert github_incident.run("notify", runner=runner, environ=environ) == 0

    body = runner.commands[-1][runner.commands[-1].index("--body") + 1]
    assert "Affected domains: unknown" in body


def test_first_update_failure_without_previous_run_is_a_noop():
    runner = FakeRunner([run_payload(42, "failure"), "[]"])

    assert github_incident.run("notify", runner=runner, environ=ENV) == 0
    assert len(runner.commands) == 2


@pytest.mark.parametrize(
    ("current_result", "job_conclusion"),
    [("failure", "success"), ("success", "failure"), ("skipped", "cancelled")],
)
def test_current_job_must_corroborate_needs_result(current_result, job_conclusion, capsys):
    runner = FakeRunner([run_payload(42, job_conclusion)])
    environ = {**ENV, "CURRENT_UPDATE_RESULT": current_result}

    assert github_incident.run("notify", runner=runner, environ=environ) == 1
    assert capsys.readouterr().err == "error: GitHub incident automation failed\n"


@pytest.mark.parametrize(
    "jobs",
    [
        [],
        [{"name": "Update data", "databaseId": 420, "conclusion": "failure"}],
        [
            {"name": "update-data", "databaseId": 420, "conclusion": "failure"},
            {"name": "update-data", "databaseId": 421, "conclusion": "failure"},
        ],
        [{"name": "update-data", "databaseId": True, "conclusion": "failure"}],
    ],
)
def test_current_run_requires_one_exact_update_job_with_integer_id(jobs, capsys):
    payload = json.loads(run_payload(42, "failure"))
    payload["jobs"] = jobs
    runner = FakeRunner([json.dumps(payload)])

    assert github_incident.run("notify", runner=runner, environ=ENV) == 1
    assert capsys.readouterr().err == "error: GitHub incident automation failed\n"


@pytest.mark.parametrize("missing", ["GITHUB_REPOSITORY", "GITHUB_RUN_ID", "CURRENT_UPDATE_RESULT", "GH_TOKEN"])
def test_required_environment_is_validated_before_running_gh(missing, capsys):
    runner = FakeRunner([])
    environ = {key: value for key, value in ENV.items() if key != missing}

    assert github_incident.run("notify", runner=runner, environ=environ) == 1
    assert runner.commands == []
    assert capsys.readouterr().err == "error: GitHub incident automation failed\n"


def test_gh_failure_is_generic_and_does_not_leak_stderr(capsys):
    def failing_runner(command, **kwargs):
        raise subprocess.CalledProcessError(1, command, stderr="token=secret")

    assert github_incident.run("notify", runner=failing_runner, environ=ENV) == 1
    assert capsys.readouterr().err == "error: GitHub incident automation failed\n"


@pytest.mark.parametrize(
    "payload",
    [
        "not json",
        '{"createdAt":"2026-08-01T02:00:00Z","databaseId":42,"url":"https://github.example/runs/42"}',
        '{"createdAt":"2026-08-01T02:00:00Z","databaseId":42,"url":"https://github.example/runs/42","jobs":[],"extra":true}',
    ],
)
def test_current_run_json_is_strict_and_errors_are_generic(payload, capsys):
    runner = FakeRunner([payload])

    assert github_incident.run("notify", runner=runner, environ=ENV) == 1
    assert capsys.readouterr().err == "error: GitHub incident automation failed\n"
