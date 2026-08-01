import asyncio
import json
from pathlib import Path

import pytest

from pipeline.diagnostics import (
    artifact_paths,
    async_capture_page,
    capture_page,
    structured_failure,
)


class SyncPage:
    def __init__(self, *, content_error=None, screenshot_error=None):
        self.content_error = content_error
        self.screenshot_error = screenshot_error
        self.calls = []

    def content(self):
        self.calls.append("content")
        if self.content_error:
            raise self.content_error
        return "<p>Grüße\r\nweiter</p>"

    def screenshot(self, **kwargs):
        self.calls.append(("screenshot", kwargs))
        if self.screenshot_error:
            raise self.screenshot_error
        Path(kwargs["path"]).write_bytes(b"png")


class AsyncPage(SyncPage):
    async def content(self):
        return super().content()

    async def screenshot(self, **kwargs):
        return super().screenshot(**kwargs)


def test_artifact_paths_sanitizes_slug_and_stays_inside_directory(tmp_path):
    directory = tmp_path / "diagnostics"

    paths = artifact_paths(directory, "../Grüße / 2026")

    assert directory.is_dir()
    assert paths.html == directory / "Grusse_2026.html"
    assert paths.screenshot == directory / "Grusse_2026.png"
    assert paths.trace == directory / "Grusse_2026-trace.zip"
    assert all(path.parent == directory for path in paths)


def test_capture_page_writes_utf8_lf_html_and_full_page_screenshot(tmp_path):
    page = SyncPage()

    result = capture_page(page, tmp_path, "failure")

    assert result.errors == ()
    assert result.paths.html.read_bytes() == "<p>Grüße\nweiter</p>".encode("utf-8")
    assert result.paths.screenshot.read_bytes() == b"png"
    assert page.calls[-1][1]["full_page"] is True


def test_capture_page_attempts_screenshot_after_html_failure(tmp_path):
    page = SyncPage(content_error=RuntimeError("html failed"))

    result = capture_page(page, tmp_path, "partial")

    assert [error.operation for error in result.errors] == ["content"]
    assert result.paths.screenshot.is_file()
    assert [call if isinstance(call, str) else call[0] for call in page.calls] == [
        "content",
        "screenshot",
    ]


def test_async_capture_page_attempts_html_after_screenshot_failure(tmp_path):
    page = AsyncPage(screenshot_error=RuntimeError("shot failed"))

    result = asyncio.run(async_capture_page(page, tmp_path, "async"))

    assert [error.operation for error in result.errors] == ["screenshot"]
    assert result.paths.html.is_file()


def test_structured_failure_is_one_json_safe_line_without_html_or_secret(tmp_path):
    paths = artifact_paths(tmp_path, "failure")
    page = SyncPage(screenshot_error=RuntimeError("token=super-secret"))
    capture = capture_page(page, tmp_path, "failure")

    line = structured_failure(
        "ranking_scraper.py",
        ValueError("selector failed\npassword=hunter2"),
        paths,
        capture.errors,
    )

    assert line.startswith("SCRAPER_FAILURE ")
    assert "\n" not in line
    assert "<p>" not in line
    assert "super-secret" not in line
    assert "hunter2" not in line
    payload = json.loads(line.removeprefix("SCRAPER_FAILURE "))
    assert list(payload) == ["artifacts", "capture_errors", "error", "script"]
    assert payload["error"]["type"] == "ValueError"
    assert "trace" not in payload["artifacts"]
    assert any(error["operation"] == "trace"
               for error in payload["capture_errors"])


def test_structured_failure_without_capture_does_not_claim_artifact_paths():
    line = structured_failure("scraper", RuntimeError("launch failed"), None)

    payload = json.loads(line.removeprefix("SCRAPER_FAILURE "))
    assert payload["artifacts"] == {}
    assert payload["capture_errors"][0]["operation"] == "capture"


def test_structured_failure_redacts_authorization_query_script_and_paths(tmp_path):
    paths = artifact_paths(tmp_path / "token=path-secret", "failure")
    paths.html.write_text("ok", encoding="utf-8")
    line = structured_failure(
        "scraper?password=script-secret",
        RuntimeError("Authorization: Bearer top secret value\r\nurl?token=query-secret"),
        paths,
    )

    assert "top secret" not in line
    assert "query-secret" not in line
    assert "script-secret" not in line
    assert "path-secret" not in line
