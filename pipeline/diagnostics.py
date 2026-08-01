"""Failure artifacts and machine-readable scraper diagnostics."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
import unicodedata
from typing import Any, Callable, Iterable, Iterator


_AUTHORIZATION = re.compile(r"(?im)(authorization\s*:\s*)[^\r\n]+")
_SECRET = re.compile(
    r"(?i)(\b(?:token|password|passwd|secret|api[_-]?key)\b\s*[:=]\s*|"
    r"[?&](?:token|password|passwd|secret|api[_-]?key)=)[^\s&;,]+"
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
        try:
            self.page = self.context.new_page()
        except Exception:
            paths = artifact_paths(self.directory, self.script)
            try:
                self.context.tracing.stop(path=str(paths.trace))
            except Exception:
                pass
            try:
                self.context.close()
            except Exception:
                pass
            raise
        return self

    def __exit__(self, error_type, error, traceback):
        if error is None:
            try:
                self.context.tracing.stop()
            except Exception as stop_error:
                return self._record_failure(stop_error)
            try:
                self.context.close()
            except Exception as close_error:
                return self._record_failure(close_error)
            return False
        return self._record_failure(error)

    def _record_failure(self, error):
        self.error = error
        try:
            capture = capture_page(self.page, self.directory, self.script)
            paths = capture.paths
            trace_errors = list(capture.errors)
        except Exception as capture_error:
            paths = None
            trace_errors = [_error("capture", capture_error)]
        try:
            if paths is not None:
                self.context.tracing.stop(path=str(paths.trace))
        except Exception as exception:
            trace_errors.append(_error("trace", exception))
        try:
            self.context.close()
        except Exception as exception:
            trace_errors.append(_error("context_close", exception))
        self.paths = paths
        self.capture_errors = tuple(trace_errors)
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
        try:
            self.page = await self.context.new_page()
        except Exception:
            paths = artifact_paths(self.directory, self.script)
            try:
                await self.context.tracing.stop(path=str(paths.trace))
            except Exception:
                pass
            try:
                await self.context.close()
            except Exception:
                pass
            raise
        return self

    async def __aexit__(self, error_type, error, traceback):
        if error is None:
            try:
                await self.context.tracing.stop()
            except Exception as stop_error:
                return await self._record_failure(stop_error)
            try:
                await self.context.close()
            except Exception as close_error:
                return await self._record_failure(close_error)
            return False
        return await self._record_failure(error)

    async def _record_failure(self, error):
        self.error = error
        try:
            capture = await async_capture_page(
                self.page, self.directory, self.script
            )
            paths = capture.paths
            trace_errors = list(capture.errors)
        except Exception as capture_error:
            paths = None
            trace_errors = [_error("capture", capture_error)]
        try:
            if paths is not None:
                await self.context.tracing.stop(path=str(paths.trace))
        except Exception as exception:
            trace_errors.append(_error("trace", exception))
        try:
            await self.context.close()
        except Exception as exception:
            trace_errors.append(_error("context_close", exception))
        self.paths = paths
        self.capture_errors = tuple(trace_errors)
        return True


class SyncDiagnosticSession:
    """Cover the complete sync Playwright/browser/context/page lifecycle."""

    def __init__(self, playwright_factory, directory, script, **launch_options):
        self.playwright_factory = playwright_factory
        self.directory = directory
        self.script = script
        self.launch_options = launch_options
        self.playwright_manager = None
        self.browser = None
        self.diagnostics = None
        self.page = None

    def __enter__(self):
        self.playwright_manager = self.playwright_factory()
        playwright = self.playwright_manager.__enter__()
        try:
            self.browser = playwright.chromium.launch(**self.launch_options)
            self.diagnostics = SyncFailureDiagnostics(
                self.browser, self.directory, self.script
            )
            self.diagnostics.__enter__()
        except Exception:
            error_info = sys.exc_info()
            try:
                if self.browser is not None:
                    self.browser.close()
            except Exception:
                pass
            self.playwright_manager.__exit__(*error_info)
            raise
        self.page = self.diagnostics.page
        return self

    def __exit__(self, error_type, error, traceback):
        handled = self.diagnostics.__exit__(error_type, error, traceback)
        teardown_errors = []
        try:
            self.browser.close()
        except Exception as close_error:
            if self.diagnostics.error is None:
                self.diagnostics.error = close_error
            teardown_errors.append(_error("browser_close", close_error))
            handled = True
        try:
            self.playwright_manager.__exit__(error_type, error, traceback)
        except Exception as manager_error:
            if self.diagnostics.error is None:
                self.diagnostics.error = manager_error
            teardown_errors.append(_error("playwright_exit", manager_error))
            handled = True
        if self.diagnostics.error is not None:
            errors = list(getattr(self.diagnostics, "capture_errors", ()))
            errors.extend(teardown_errors)
            print(structured_failure(
                self.script, self.diagnostics.error,
                getattr(self.diagnostics, "paths", None), errors,
            ))
        return handled

    @property
    def error(self):
        return self.diagnostics.error


class AsyncDiagnosticSession:
    """Cover the complete async Playwright/browser/context/page lifecycle."""

    def __init__(self, playwright_factory, directory, script, **launch_options):
        self.playwright_factory = playwright_factory
        self.directory = directory
        self.script = script
        self.launch_options = launch_options
        self.playwright_manager = None
        self.browser = None
        self.diagnostics = None
        self.page = None

    async def __aenter__(self):
        self.playwright_manager = self.playwright_factory()
        playwright = await self.playwright_manager.__aenter__()
        try:
            self.browser = await playwright.chromium.launch(**self.launch_options)
            self.diagnostics = AsyncFailureDiagnostics(
                self.browser, self.directory, self.script
            )
            await self.diagnostics.__aenter__()
        except Exception:
            error_info = sys.exc_info()
            try:
                if self.browser is not None:
                    await self.browser.close()
            except Exception:
                pass
            await self.playwright_manager.__aexit__(*error_info)
            raise
        self.page = self.diagnostics.page
        return self

    async def __aexit__(self, error_type, error, traceback):
        handled = await self.diagnostics.__aexit__(error_type, error, traceback)
        teardown_errors = []
        try:
            await self.browser.close()
        except Exception as close_error:
            if self.diagnostics.error is None:
                self.diagnostics.error = close_error
            teardown_errors.append(_error("browser_close", close_error))
            handled = True
        try:
            await self.playwright_manager.__aexit__(error_type, error, traceback)
        except Exception as manager_error:
            if self.diagnostics.error is None:
                self.diagnostics.error = manager_error
            teardown_errors.append(_error("playwright_exit", manager_error))
            handled = True
        if self.diagnostics.error is not None:
            errors = list(getattr(self.diagnostics, "capture_errors", ()))
            errors.extend(teardown_errors)
            print(structured_failure(
                self.script, self.diagnostics.error,
                getattr(self.diagnostics, "paths", None), errors,
            ))
        return handled

    @property
    def error(self):
        return self.diagnostics.error


def _safe_message(value: object, limit: int = 300) -> str:
    message = _AUTHORIZATION.sub(r"\1[REDACTED]", str(value))
    message = _SECRET.sub(lambda match: f"{match.group(1)}[REDACTED]", message)
    message = message.replace("\r", " ").replace("\n", " ")
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
    paths: ArtifactPaths | None,
    errors: Iterable[CaptureError] = (),
) -> str:
    capture_errors = list(errors)
    artifacts = {}
    if paths is None:
        capture_errors.append(
            CaptureError("capture", "ArtifactUnavailable", "capture did not start")
        )
    else:
        for name, path in (
            ("html", paths.html),
            ("screenshot", paths.screenshot),
            ("trace", paths.trace),
        ):
            if path.is_file():
                artifacts[name] = _safe_message(path)
            elif not any(item.operation == name for item in capture_errors):
                capture_errors.append(
                    CaptureError(
                        name, "ArtifactUnavailable", "artifact was not created"
                    )
                )
    payload = {
        "artifacts": artifacts,
        "capture_errors": [
            {
                "message": _safe_message(item.message),
                "operation": item.operation,
                "type": item.error_type,
            }
            for item in capture_errors
        ],
        "error": {
            "message": _safe_message(error),
            "type": type(error).__name__,
        },
        "script": _safe_message(script),
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
        print(structured_failure(script, error, None))
        return 1
