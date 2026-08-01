from __future__ import annotations

import subprocess

import pytest

from pipeline import github_incident


ENV = {
    "GITHUB_REPOSITORY": "owner/repository",
    "GITHUB_RUN_URL": "https://github.example/owner/repository/actions/runs/42",
    "GH_TOKEN": "test-token",
}


class FakeRunner:
    def __init__(self, outputs: list[str]):
        self.outputs = iter(outputs)
        self.commands: list[list[str]] = []
        self.kwargs: list[dict[str, object]] = []

    def __call__(self, command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        self.kwargs.append(kwargs)
        return subprocess.CompletedProcess(command, 0, next(self.outputs), "")


def test_failure_is_first_strike_when_previous_scheduled_run_succeeded():
    runner = FakeRunner(['[{"conclusion":"success","databaseId":41,"url":"https://run/41"}]'])

    assert github_incident.run("failure", runner=runner, environ=ENV) == 0

    assert len(runner.commands) == 1
    assert runner.commands[0][:4] == ["gh", "run", "list", "--repo"]
    assert "--event" in runner.commands[0]
    assert runner.commands[0][runner.commands[0].index("--event") + 1] == "schedule"
    assert runner.commands[0][runner.commands[0].index("--status") + 1] == "completed"
    assert all(call.get("shell") is not True for call in runner.kwargs)


def test_failure_opens_incident_on_second_consecutive_scheduled_failure():
    runner = FakeRunner(
        [
            '[{"conclusion":"failure","databaseId":41,"url":"https://run/41"}]',
            "label ensured\n",
            "[]",
            "https://github.example/issues/7\n",
        ]
    )

    assert github_incident.run("failure", runner=runner, environ=ENV) == 0

    label = runner.commands[1]
    assert label == [
        "gh", "label", "create", "automated-scraper-failure",
        "--color", "D73A4A",
        "--description", "Repeated failures in the scheduled data update",
        "--force",
        "--repo", "owner/repository",
    ]
    create = runner.commands[-1]
    assert create[:3] == ["gh", "issue", "create"]
    assert create[create.index("--label") + 1] == "automated-scraper-failure"
    body = create[create.index("--body") + 1]
    assert ENV["GITHUB_RUN_URL"] in body
    assert "report" not in body.lower()


def test_repeated_failure_comments_on_existing_incident():
    runner = FakeRunner(
        [
            '[{"conclusion":"failure","databaseId":41,"url":"https://run/41"}]',
            "label ensured\n",
            '[{"number":7}]',
            "https://github.example/issues/7#comment\n",
        ]
    )

    assert github_incident.run("failure", runner=runner, environ=ENV) == 0

    assert runner.commands[1][:4] == ["gh", "label", "create", "automated-scraper-failure"]
    assert runner.commands[-1][:4] == ["gh", "issue", "comment", "7"]
    assert ENV["GITHUB_RUN_URL"] in runner.commands[-1][-1]


def test_label_provisioning_failure_is_generic_and_does_not_touch_issues(capsys):
    calls = []

    def runner(command, **kwargs):
        calls.append(command)
        if command[:3] == ["gh", "label", "create"]:
            raise subprocess.CalledProcessError(1, command, stderr="token=secret")
        return subprocess.CompletedProcess(
            command,
            0,
            '[{"conclusion":"failure","databaseId":41,"url":"https://run/41"}]',
            "",
        )

    assert github_incident.run("failure", runner=runner, environ=ENV) == 1

    assert all(command[:3] != ["gh", "issue", "list"] for command in calls)
    assert capsys.readouterr().err == "error: GitHub incident automation failed\n"


def test_recovery_comments_and_closes_existing_incident():
    runner = FakeRunner(
        [
            '[{"number":7}]',
            "https://github.example/issues/7#comment\n",
            "closed\n",
        ]
    )

    assert github_incident.run("recovery", runner=runner, environ=ENV) == 0

    assert runner.commands[-2][:4] == ["gh", "issue", "comment", "7"]
    assert runner.commands[-1][:4] == ["gh", "issue", "close", "7"]
    assert ENV["GITHUB_RUN_URL"] in runner.commands[-2][-1]


def test_recovery_without_open_incident_is_a_noop():
    runner = FakeRunner(["[]"])

    assert github_incident.run("recovery", runner=runner, environ=ENV) == 0
    assert len(runner.commands) == 1


@pytest.mark.parametrize(
    "outputs",
    [
        ["not json"],
        ['[{"conclusion":"failure","databaseId":"41","url":"https://run/41"}]'],
        ['[{"number":true}]'],
    ],
)
def test_malformed_gh_json_returns_generic_failure(outputs, capsys):
    runner = FakeRunner(outputs)
    mode = "recovery" if "number" in outputs[0] else "failure"

    assert github_incident.run(mode, runner=runner, environ=ENV) == 1

    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "error: GitHub incident automation failed\n"
    assert outputs[0] not in captured.err


@pytest.mark.parametrize("missing", ["GITHUB_REPOSITORY", "GITHUB_RUN_URL", "GH_TOKEN"])
def test_required_environment_is_validated_before_running_gh(missing, capsys):
    runner = FakeRunner([])
    environ = {key: value for key, value in ENV.items() if key != missing}

    assert github_incident.run("failure", runner=runner, environ=environ) == 1

    assert runner.commands == []
    assert capsys.readouterr().err == "error: GitHub incident automation failed\n"


def test_gh_command_failure_returns_generic_failure(capsys):
    def failing_runner(command, **kwargs):
        raise subprocess.CalledProcessError(1, command, stderr="token=secret")

    assert github_incident.run("failure", runner=failing_runner, environ=ENV) == 1
    assert capsys.readouterr().err == "error: GitHub incident automation failed\n"
