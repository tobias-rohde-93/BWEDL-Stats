from __future__ import annotations

import json
import mimetypes
import os
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest


ROOT = Path(__file__).resolve().parents[1]
PAGES_PREFIX = "/BWEDL-Stats/"
PLAYER_SENTINEL = '<img data-bwedl-injected onerror="document.body.dataset.xss=1">PLAYER_SENTINEL'
LEGACY_SENTINEL = "LEGACY_AMBIGUOUS_SENTINEL"


def javascript_assignment(name: str, value: object) -> bytes:
    return f"window.{name} = {json.dumps(value, ensure_ascii=False)};".encode("utf-8")


TEST_ASSETS = {
    "league_data.js": javascript_assignment(
        "LEAGUE_DATA",
        {
            "leagues": {
                "A-Klasse 2026-2027": {
                    "url": "https://example.invalid/league",
                    "match_days": {
                        "1. Spieltag": "Mo. 24.08.2026 20:00 Malicious Club - Safe Team ---",
                    },
                    "table": (
                        "<table><tbody>"
                        "<tr><th>Pl.</th><th>Tabelle</th><th>Sp</th><th>Pkt</th></tr>"
                        "<tr><td>1</td><td><img data-bwedl-injected "
                        "onerror=\"document.body.dataset.xss=2\">LEAGUE_SENTINEL</td>"
                        "<td>1</td><td>2</td></tr>"
                        "</tbody></table>"
                    ),
                }
            }
        },
    ),
    "ranking_data.js": javascript_assignment(
        "RANKING_DATA",
        {
            "players": [
                {
                    "id": "9001",
                    "v_nr": "999",
                    "name": PLAYER_SENTINEL,
                    "rank": "1",
                    "points": "42",
                    "league": "A-Klasse",
                    "company": "Malicious Club",
                    "rounds": {"R1": "42"},
                },
                {
                    "id": "9001",
                    "v_nr": "999",
                    "name": PLAYER_SENTINEL,
                    "rank": "2",
                    "points": "40",
                    "league": "B-Klasse",
                    "company": "Malicious Club",
                    "rounds": {"R1": "40"},
                },
                {
                    "id": "7001",
                    "v_nr": "998",
                    "name": LEGACY_SENTINEL,
                    "rank": "3",
                    "points": "30",
                    "league": "A-Klasse",
                    "company": "Legacy Club One",
                    "rounds": {"R1": "30"},
                },
                {
                    "id": "7002",
                    "v_nr": "997",
                    "name": LEGACY_SENTINEL,
                    "rank": "4",
                    "points": "20",
                    "league": "A-Klasse",
                    "company": "Legacy Club Two",
                    "rounds": {"R1": "20"},
                },
            ],
            "rankings": {
                "A-Klasse": "<table><tbody></tbody></table>",
                "B-Klasse": "<table><tbody></tbody></table>",
            },
        },
    ),
    "club_data.js": javascript_assignment(
        "CLUB_DATA",
        {
            "clubs": [
                {"number": "999", "name": "Malicious Club", "city": "Teststadt"},
                {"number": "998", "name": "Legacy Club One", "city": "Teststadt"},
                {"number": "997", "name": "Legacy Club Two", "city": "Teststadt"},
            ]
        },
    ),
}


class GitHubPagesTestHandler(BaseHTTPRequestHandler):
    server: "GitHubPagesTestServer"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802 - stdlib hook
        self._serve(include_body=True)

    def do_HEAD(self) -> None:  # noqa: N802 - stdlib hook
        self._serve(include_body=False)

    def _serve(self, *, include_body: bool) -> None:
        request_path = unquote(urlsplit(self.path).path)
        self.server.request_paths.append(request_path)
        if not request_path.startswith(PAGES_PREFIX):
            self.send_error(404)
            return

        relative = request_path[len(PAGES_PREFIX) :] or "index.html"
        if relative in TEST_ASSETS:
            payload = TEST_ASSETS[relative]
            content_type = "text/javascript; charset=utf-8"
        else:
            target = (ROOT / relative).resolve()
            try:
                target.relative_to(ROOT.resolve())
            except ValueError:
                self.send_error(404)
                return
            if not target.is_file():
                self.send_error(404)
                return
            payload = target.read_bytes()
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if include_body:
            self.wfile.write(payload)


class GitHubPagesTestServer(ThreadingHTTPServer):
    request_paths: list[str]


@contextmanager
def github_pages_server():
    server = GitHubPagesTestServer(("127.0.0.1", 0), GitHubPagesTestHandler)
    server.request_paths = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        yield server, f"http://127.0.0.1:{port}{PAGES_PREFIX}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.skipif(
    os.environ.get("BWEDL_BROWSER_TESTS") != "1",
    reason="set BWEDL_BROWSER_TESTS=1 to run the real Chromium security smoke",
)
def test_published_data_stays_inert_online_and_offline() -> None:
    from playwright.sync_api import expect, sync_playwright

    console_errors: list[str] = []
    page_errors: list[str] = []
    requested_urls: list[str] = []

    with github_pages_server() as (server, base_url), sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(service_workers="allow")
        page = context.new_page()
        page.on("request", lambda request: requested_urls.append(request.url))
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "console",
            lambda message: console_errors.append(message.text) if message.type == "error" else None,
        )

        page.goto(base_url, wait_until="domcontentloaded")
        expect(page.locator("#current-league-title")).to_have_text("Dashboard")

        with page.expect_navigation(wait_until="domcontentloaded"):
            page.locator("#update-btn").click()
        expect(page.locator("#current-league-title")).to_have_text("Dashboard")

        page.evaluate("location.hash = '#league/A-Klasse%202026-2027'")
        expect(page.locator("#current-league-title")).to_contain_text("A-Klasse 2026-2027")
        expect(page.locator("#league-table-container")).to_contain_text("LEAGUE_SENTINEL")

        page.evaluate("location.hash = '#ranking/A-Klasse'")
        expect(page.locator("#current-league-title")).to_have_text("A-Klasse")
        expect(page.locator(".ranking-table")).to_contain_text("PLAYER_SENTINEL")

        page.locator("#global-search").fill("PLAYER_SENTINEL")
        expect(page.locator("#search-results")).to_contain_text("PLAYER_SENTINEL")

        page.evaluate(
            "name => localStorage.setItem('myPlayerName', name)",
            LEGACY_SENTINEL,
        )
        page.reload(wait_until="domcontentloaded")
        page.evaluate("location.hash = '#profile'")
        expect(page.locator(".profile-selection-status")).to_contain_text("nicht eindeutig")
        search = page.locator("#profile-player-search-input")
        search.fill("")
        search.fill(LEGACY_SENTINEL)
        expect(page.locator(".profile-suggestion-button")).to_have_count(2)
        search.fill("PLAYER_SENTINEL")
        suggestion = page.locator(".profile-suggestion-button")
        expect(suggestion).to_have_count(1)
        suggestion.click()
        primary_class = page.locator("#profile-primary-class-select")
        expect(primary_class).to_be_visible()
        expect(primary_class.locator("option")).to_have_count(3)
        primary_class.select_option("A-Klasse|9001")
        page.get_by_role("button", name="Speichern").click()
        expect(page.locator("#my-profile-link")).to_contain_text("PLAYER_SENTINEL")
        stored_profile = page.evaluate(
            "key => JSON.parse(localStorage.getItem(key))",
            "bwedl_player_profile",
        )
        assert stored_profile["recordKey"] == "A-Klasse|9001"

        page.evaluate("location.hash = '#tools'")
        expect(page.get_by_text("Match Setup", exact=True)).to_be_visible()
        expect(page.locator("#player-list")).to_contain_text("PLAYER_SENTINEL")

        assert page.locator("[data-bwedl-injected]").count() == 0
        assert page.evaluate("document.body.dataset.xss || null") is None
        assert page.get_by_text("JS Error:", exact=False).count() == 0

        page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller")
        page.reload(wait_until="domcontentloaded")
        expect(page.locator("#current-league-title")).to_have_text("Match Center")
        assert page_errors == []
        expect(page.get_by_text("Match Setup", exact=True)).to_be_visible()
        expect(page.locator("#player-list")).to_contain_text("PLAYER_SENTINEL")

        page.set_viewport_size({"width": 390, "height": 844})
        context.set_offline(True)
        page.reload(wait_until="domcontentloaded")
        expect(page.get_by_text("Match Setup", exact=True)).to_be_visible()
        expect(page.locator("#my-profile-link")).to_contain_text("PLAYER_SENTINEL")
        assert page.locator("[data-bwedl-injected]").count() == 0
        assert page.evaluate("document.body.dataset.xss || null") is None
        context.set_offline(False)

        context.close()
        browser.close()

    application_console_errors = [
        message for message in console_errors if "Failed to load resource" not in message
    ]
    assert page_errors == []
    assert application_console_errors == []
    assert not any("/api/" in urlsplit(url).path for url in requested_urls)
    assert not any("/api/" in path for path in server.request_paths)
