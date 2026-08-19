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


def job_block(text: str, job_name: str, next_job: str | None = None) -> str:
    end = rf"(?=^  {re.escape(next_job)}:|\Z)" if next_job else r"\Z"
    match = re.search(rf"(?ms)^  {re.escape(job_name)}:\n.*?{end}", text)
    assert match is not None, f"missing workflow job: {job_name}"
    return match.group(0)


def test_workflow_has_hardened_triggers_concurrency_and_update_timeout():
    text = workflow_text()
    update_job = job_block(text, "update-data", "notify")

    assert "cron: '0 */6 * * *'" in text
    assert re.search(r"(?m)^  workflow_dispatch:\s*$", text)
    assert "group: ${{ github.workflow }}-${{ github.ref }}" in text
    assert "cancel-in-progress: false" in text
    job_timeout = int(re.search(r"(?m)^    timeout-minutes: (\d+)$", update_job).group(1))
    assert job_timeout >= 45


def test_offline_tests_run_before_browser_install_and_live_update():
    text = workflow_text()
    test_index = text.index("python -m pytest")
    browser_index = text.index("python -m playwright install --with-deps chromium")
    update_index = text.index("python update_data.py")

    assert test_index < browser_index < update_index
    assert "python-version: '3.13'" in text
    assert "cache: 'pip'" in text


def test_browser_security_smoke_runs_after_chromium_and_before_live_update():
    text = workflow_text()
    browser_install_index = text.index("python -m playwright install --with-deps chromium")
    browser_smoke_index = text.index("python -m pytest tests/test_browser_security.py -q")
    update_index = text.index("python update_data.py")
    smoke = step_block(text, "Run browser security smoke")

    assert browser_install_index < browser_smoke_index < update_index
    assert 'BWEDL_BROWSER_TESTS: "1"' in smoke


def test_action_versions_and_checkout_history_are_maintained():
    text = workflow_text()

    assert text.count("actions/checkout@v7") == 2
    assert text.count("actions/setup-python@v6") == 2
    assert text.count("actions/upload-artifact@v7") == 1
    assert "actions/checkout@v6" not in text
    assert "actions/setup-python@v7" not in text
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


def test_live_update_step_has_transactional_timeout_before_always_evidence_steps():
    text = workflow_text()
    update_job = job_block(text, "update-data", "notify")
    update = step_block(text, "Run live data update")

    job_timeout = int(re.search(r"(?m)^    timeout-minutes: (\d+)$", update_job).group(1))
    step_timeout = int(re.search(r"(?m)^        timeout-minutes: (\d+)$", update).group(1))
    assert step_timeout == 20
    assert job_timeout - step_timeout >= 25
    assert text.index("Run live data update") < text.index("Render update summary")
    assert text.index("Run live data update") < text.index("Upload failure diagnostics")


def test_commit_uses_explicit_generated_file_allowlist_only():
    text = workflow_text()
    commit = step_block(text, "Commit and push generated data")
    allowed = {
        "league_data.json", "league_data.js",
        "ranking_data.json", "ranking_data.js",
        "club_data.json", "club_data.js",
        "archive_data.js", "archive_tables.js",
        "data_status.json", "data_status.js",
        "calendar_index.json", "calendar_index.js", "calendar_state.json", "calendars",
    }

    assert "git add ." not in commit
    add_line = next(line.strip() for line in commit.splitlines() if line.strip().startswith("git add --"))
    assert set(add_line.removeprefix("git add -- ").split()) == allowed
    assert "git diff --staged --quiet" in commit
    assert "git commit" in commit
    assert "git push" in commit


def test_notify_job_is_separate_always_scheduled_and_least_privilege():
    text = workflow_text()
    update_job = job_block(text, "update-data", "notify")
    notify_job = job_block(text, "notify")

    assert "pipeline.github_incident" not in update_job
    assert "permissions:\n      contents: write" in update_job
    assert "issues: write" not in update_job
    assert "needs: update-data" in notify_job
    assert "if: ${{ always() && github.event_name == 'schedule' }}" in notify_job
    for permission in ("actions: read", "issues: write", "contents: read"):
        assert permission in notify_job
    assert "CURRENT_UPDATE_RESULT: ${{ needs.update-data.result }}" in notify_job
    assert "python -m pipeline.github_incident notify" in notify_job
    assert "gh run download" in notify_job
    assert "continue-on-error: true" in notify_job
    assert "REPORT_PATH:" in notify_job


def test_notify_job_uses_current_actions_and_update_result_not_notify_result():
    text = workflow_text()
    notify_job = job_block(text, "notify")

    assert "actions/checkout@v7" in notify_job
    assert "actions/setup-python@v6" in notify_job
    assert "needs.update-data.result" in notify_job
    assert "needs.notify" not in notify_job
