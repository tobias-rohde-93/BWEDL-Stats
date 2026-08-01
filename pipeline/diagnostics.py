"""Failure artifacts and machine-readable scraper diagnostics."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import unicodedata
from typing import Any, Callable, Iterable, Iterator


_SECRET = re.compile(
    r"(?i)\b(token|password|passwd|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+"
)


@dataclass(frozen=True)
class ArtifactPaths:
    html: Path
    screenshot: Path
    trace: Path

    def __iter__(self) -> Iterator[Path]:
        return iter((self.html, self.screenshot, self.trace))


@dataclass(frozen=True)
class CaptureError:
    operation: str
    error_type: str
    message: str


@dataclass(frozen=True)
class CaptureResult:
    paths: ArtifactPaths
    errors: tuple[CaptureError, ...]


class SyncFailureDiagnostics:
    """Own a traced sync context and convert an escaping failure to artifacts."""

    def __init__(self, browser: Any, directory: Path | str, script: str):
        self.context = browser.new_context()
        self.directory = directory
        self.script = script
        self.page = None
        self.error: BaseException | None = None

    def __enter__(self):
        self.context.tracing.start(
            screenshots=True, snapshots=True, sources=True
        )
        self.page = self.context.new_page()
        return self

    def __exit__(self, error_type, error, traceback):
        if error is None:
            self.context.tracing.stop()
            self.context.close()
            return False
        self.error = error
        capture = capture_page(self.page, self.directory, self.script)
        trace_errors = list(capture.errors)
        try:
            self.context.tracing.stop(path=str(capture.paths.trace))
        except Exception as exception:
            trace_errors.append(_error("trace", exception))
        try:
            self.context.close()
        except Exception as exception:
            trace_errors.append(_error("context_close", exception))
        print(structured_failure(self.script, error, capture.paths, trace_errors))
        return True


class AsyncFailureDiagnostics:
    """Async equivalent of :class:`SyncFailureDiagnostics`."""

    def __init__(self, browser: Any, directory: Path | str, script: str):
        self.browser = browser
        self.directory = directory
        self.script = script
        self.context = None
        self.page = None
        self.error: BaseException | None = None

    async def __aenter__(self):
        self.context = await self.browser.new_context()
        await self.context.tracing.start(
            screenshots=True, snapshots=True, sources=True
        )
        self.page = await self.context.new_page()
        return self

    async def __aexit__(self, error_type, error, traceback):
        if error is None:
            await self.context.tracing.stop()
            await self.context.close()
            return False
        self.error = error
        capture = await async_capture_page(
            self.page, self.directory, self.script
        )
        trace_errors = list(capture.errors)
        try:
            await self.context.tracing.stop(path=str(capture.paths.trace))
        except Exception as exception:
            trace_errors.append(_error("trace", exception))
        try:
            await self.context.close()
        except Exception as exception:
            trace_errors.append(_error("context_close", exception))
        print(structured_failure(self.script, error, capture.paths, trace_errors))
        return True


def _safe_message(value: object, limit: int = 300) -> str:
    message = str(value).replace("\r", " ").replace("\n", " ")
    message = _SECRET.sub(lambda match: f"{match.group(1)}=[REDACTED]", message)
    return message[:limit]


def _error(operation: str, exception: BaseException) -> CaptureError:
    return CaptureError(operation, type(exception).__name__, _safe_message(exception))


def artifact_paths(directory: Path | str, slug: str) -> ArtifactPaths:
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    ascii_slug = unicodedata.normalize("NFKD", str(slug).replace("ß", "ss")).encode(
        "ascii", "ignore"
    ).decode("ascii")
    safe_slug = re.sub(r"[^A-Za-z0-9_-]+", "_", ascii_slug).strip("_")
    safe_slug = safe_slug or "failure"
    return ArtifactPaths(
        directory / f"{safe_slug}.html",
        directory / f"{safe_slug}.png",
        directory / f"{safe_slug}-trace.zip",
    )


def _write_html(path: Path, content: str) -> None:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    path.write_text(normalized, encoding="utf-8", newline="\n")


def capture_page(page: Any, directory: Path | str, slug: str) -> CaptureResult:
    paths = artifact_paths(directory, slug)
    errors: list[CaptureError] = []
    try:
        _write_html(paths.html, page.content())
    except Exception as exception:
        errors.append(_error("content", exception))
    try:
        page.screenshot(path=str(paths.screenshot), full_page=True)
    except Exception as exception:
        errors.append(_error("screenshot", exception))
    return CaptureResult(paths, tuple(errors))


async def async_capture_page(
    page: Any, directory: Path | str, slug: str
) -> CaptureResult:
    paths = artifact_paths(directory, slug)
    errors: list[CaptureError] = []
    try:
        _write_html(paths.html, await page.content())
    except Exception as exception:
        errors.append(_error("content", exception))
    try:
        await page.screenshot(path=str(paths.screenshot), full_page=True)
    except Exception as exception:
        errors.append(_error("screenshot", exception))
    return CaptureResult(paths, tuple(errors))


def structured_failure(
    script: str,
    error: BaseException,
    paths: ArtifactPaths,
    errors: Iterable[CaptureError] = (),
) -> str:
    payload = {
        "artifacts": {
            "html": str(paths.html),
            "screenshot": str(paths.screenshot),
            "trace": str(paths.trace),
        },
        "capture_errors": [
            {
                "message": _safe_message(item.message),
                "operation": item.operation,
                "type": item.error_type,
            }
            for item in errors
        ],
        "error": {
            "message": _safe_message(error),
            "type": type(error).__name__,
        },
        "script": str(script),
    }
    return "SCRAPER_FAILURE " + json.dumps(
        payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    )


def scraper_status(
    script: str, directory: Path | str, operation: Callable[[], Any]
) -> int:
    """Return a CLI status and prevent unexpected errors from leaking tracebacks."""
    try:
        return int(operation() or 0)
    except Exception as error:
        paths = artifact_paths(directory, script)
        print(structured_failure(script, error, paths))
        return 1
