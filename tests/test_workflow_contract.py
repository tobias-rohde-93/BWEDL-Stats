from __future__ import annotations

import re
from pathlib import Path


WORKFLOW = Path(__file__).parents[1] / ".github" / "workflows" / "update.yml"


def workflow_text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def step_block(text: str, name: str) -> str:
    match = re.search(
        rf"(?ms)^      - name: {re.escape(name)}\n(.*?)(?=^      - name:|\Z)", text
    )
    assert match is not None, f"missing workflow step: {name}"
    return match.group(0)


def test_workflow_has_hardened_triggers_concurrency_permissions_and_timeout():
    text = workflow_text()

    assert "cron: '0 */6 * * *'" in text
    assert re.search(r"(?m)^  workflow_dispatch:\s*$", text)
    assert "group: ${{ github.workflow }}-${{ github.ref }}" in text
    assert "cancel-in-progress: false" in text
    assert "timeout-minutes: 30" in text
    for permission in ("contents: write", "issues: write", "actions: read"):
        assert permission in text


def test_offline_tests_run_before_browser_install_and_live_update():
    text = workflow_text()
    test_index = text.index("python -m pytest")
    browser_index = text.index("python -m playwright install --with-deps chromium")
    update_index = text.index("python update_data.py")

    assert test_index < browser_index < update_index
    assert "python-version: '3.13'" in text
    assert "cache: 'pip'" in text


def test_action_versions_and_checkout_history_are_maintained():
    text = workflow_text()

    assert "actions/checkout@v6" in text
    assert "actions/setup-python@v6" in text
    assert "actions/upload-artifact@v7" in text
    assert "fetch-depth: 2" in text


def test_summary_and_failure_artifacts_do_not_mask_the_update_result():
    text = workflow_text()
    summary = step_block(text, "Render update summary")
    artifacts = step_block(text, "Upload failure diagnostics")

    assert "if: ${{ always() }}" in summary
    assert "GITHUB_STEP_SUMMARY" in summary
    assert "update_report.json" in summary
    assert "if [ -f update_report.json ]" in summary
    assert "if: ${{ failure() }}" in artifacts
    assert "artifacts/**" in artifacts
    assert "diagnostics/**" not in artifacts
    assert "retention-days: 14" in artifacts
    assert "if-no-files-found: warn" in artifacts


def test_commit_uses_explicit_generated_file_allowlist_only():
    text = workflow_text()
    commit = step_block(text, "Commit and push generated data")
    allowed = {
        "league_data.json", "league_data.js",
        "ranking_data.json", "ranking_data.js",
        "club_data.json", "club_data.js",
        "archive_data.js", "archive_tables.js",
        "data_status.json", "data_status.js",
    }

    assert "git add ." not in commit
    add_line = next(line.strip() for line in commit.splitlines() if line.strip().startswith("git add --"))
    assert set(add_line.removeprefix("git add -- ").split()) == allowed
    assert "git diff --staged --quiet" in commit
    assert "git commit" in commit
    assert "git push" in commit


def test_incident_automation_is_scheduled_only_and_uses_gh_token():
    text = workflow_text()
    failure = step_block(text, "Record scheduled failure")
    recovery = step_block(text, "Resolve scheduled incident")

    assert "github.event_name == 'schedule'" in failure
    assert "failure()" in failure
    assert "python -m pipeline.github_incident failure" in failure
    assert "github.event_name == 'schedule'" in recovery
    assert "success()" in recovery
    assert "python -m pipeline.github_incident recovery" in recovery
    for block in (failure, recovery):
        assert "GH_TOKEN: ${{ github.token }}" in block
        assert "GITHUB_RUN_URL:" in block
