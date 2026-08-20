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
TEST_CALENDAR_PATH = "calendars/club-999-team-1.ics"


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
                        "<tr><td>2</td><td>Safe Team</td><td>1</td><td>0</td></tr>"
                        "</tbody></table>"
                    ),
                },
                "Ligapokal 2026-2027": {
                    "url": "https://example.invalid/cup",
                    "match_days": {
                        "1. Runde": "Fr. 28.08.2026 20:00 Malicious Club - Safe Team ---",
                    },
                    "table": (
                        "<table><tbody><tr><th>Datum</th><th>Heimmannschaft</th>"
                        "<th>Ergebnis</th><th>Auswärtsmannschaft</th><th>Spielort</th></tr>"
                        "<tr><td>28.08.2026</td><td>Malicious Club Team Eins</td><td>---</td>"
                        "<td>Safe Team mit langem Namen</td><td>Testlokal Teststadt</td></tr>"
                        "</tbody></table>"
                    ),
                },
            }
        },
    ),
    "ligapokal_archive.js": javascript_assignment(
        "LIGAPOKAL_ARCHIVE",
        {
            "Ligapokal 2025-2026": {
                "tables": [
                    {
                        "rows": [
                            [
                                "Datum",
                                "Heimmannschaft",
                                "Ergebnis",
                                "Auswärtsmannschaft",
                                "Spielort",
                            ],
                            [
                                "28.08.2025",
                                "Malicious Club Team Eins",
                                "2:1",
                                "Safe Team mit langem Namen",
                                "Testlokal Teststadt",
                            ],
                        ]
                    }
                ]
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
    "archive_data.js": javascript_assignment(
        "ARCHIVE_DATA",
        {
            **{
                f"91{index:02d}": [
                    {
                        "id": f"91{index:02d}",
                        "season": "2025/2026",
                        "name": f"Historische Heimspielerin {index + 1}",
                        "league": "A-Klasse",
                        "v_nr": "999",
                        "points": (60 - index * 6) * 4,
                        "appearances": 4,
                        "points_per_appearance": 60 - index * 6,
                        "rounds": {f"R{round_index + 1}": 60 - index * 6 for round_index in range(4)},
                    }
                ]
                for index in range(4)
            },
            **{
                f"92{index:02d}": [
                    {
                        "id": f"92{index:02d}",
                        "season": "2025/2026",
                        "name": f"Historischer Gastspieler {index + 1}",
                        "league": "A-Klasse",
                        "v_nr": "996",
                        "points": (38 - index * 3) * 4,
                        "appearances": 4,
                        "points_per_appearance": 38 - index * 3,
                        "rounds": {f"R{round_index + 1}": 38 - index * 3 for round_index in range(4)},
                    }
                ]
                for index in range(4)
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
                {"number": "996", "name": "Safe Team", "city": "Teststadt"},
            ]
        },
    ),
    "calendar_index.js": javascript_assignment(
        "BWEDL_CALENDAR_INDEX",
        {
            "schema_version": 1,
            "season": "2026-2027",
            "updated_at": "2026-08-19T01:05:38Z",
            "teams": {
                "malicious club": {
                    "club_number": "999",
                    "name": "Malicious Club",
                    "path": TEST_CALENDAR_PATH,
                    "team_id": "club-999-team-1",
                    "team_slot": 1,
                    "warning_count": 0,
                }
            },
        },
    ),
    TEST_CALENDAR_PATH: (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//BWEDL//Browser Fixture//DE\r\n"
        "CALSCALE:GREGORIAN\r\n"
        "METHOD:PUBLISH\r\n"
        "X-WR-CALNAME:Malicious Club Spieltermine\r\n"
        "BEGIN:VEVENT\r\n"
        "UID:browser-past@calendar.bwedl.invalid\r\n"
        "DTSTAMP:20260819T010538Z\r\n"
        "DTSTART:20000824T180000Z\r\n"
        "DTEND:20000824T210000Z\r\n"
        "SUMMARY:Früheres Heimspiel gegen Safe Team\r\n"
        "DESCRIPTION:Gegner: Safe Team\\nHeimspiel\\nTermin: 20:00 Uhr\r\n"
        "LOCATION:Testlokal\\, Teststraße 1\\, Teststadt\r\n"
        "SEQUENCE:0\r\n"
        "LAST-MODIFIED:20260819T010538Z\r\n"
        "STATUS:CONFIRMED\r\n"
        "END:VEVENT\r\n"
        "BEGIN:VEVENT\r\n"
        "UID:browser-future@calendar.bwedl.invalid\r\n"
        "DTSTAMP:20260819T010538Z\r\n"
        "DTSTART:20990824T180000Z\r\n"
        "DTEND:20990824T210000Z\r\n"
        "SUMMARY:Heimspiel gegen Safe Team\r\n"
        "DESCRIPTION:Gegner: Safe Team\\nHeimspiel\\nTermin: 20:00 Uhr\r\n"
        "LOCATION:Testlokal\\, Teststraße 1\\, Teststadt\r\n"
        "SEQUENCE:0\r\n"
        "LAST-MODIFIED:20260819T010538Z\r\n"
        "STATUS:CONFIRMED\r\n"
        "END:VEVENT\r\n"
        "BEGIN:VEVENT\r\n"
        "UID:browser-cancelled@calendar.bwedl.invalid\r\n"
        "DTSTAMP:20260819T010538Z\r\n"
        "DTSTART:20990924T180000Z\r\n"
        "DTEND:20990924T210000Z\r\n"
        "SUMMARY:Abgesagtes Auswärtsspiel gegen Safe Team\r\n"
        "DESCRIPTION:Gegner: Safe Team\\nAuswärtsspiel\\nTermin: 20:00 Uhr\r\n"
        "LOCATION:Safe Lokal\\, Teststraße 2\\, Teststadt\r\n"
        "SEQUENCE:1\r\n"
        "LAST-MODIFIED:20260819T010538Z\r\n"
        "STATUS:CANCELLED\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    ).encode("utf-8"),
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
            content_type = (
                "text/calendar; charset=utf-8"
                if relative.endswith(".ics")
                else "text/javascript; charset=utf-8"
            )
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
        context = browser.new_context(service_workers="allow", accept_downloads=True)
        page = context.new_page()
        page.add_init_script(path=str(ROOT / "match_preview_model.js"))
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
        page.evaluate(
            """() => Object.defineProperty(document, 'baseURI', {
                configurable: true,
                value: 'https://stats.example.test/BWEDL-Stats/',
            })"""
        )
        page.get_by_role("button", name="Speichern").click()
        expect(page.locator("#my-profile-link")).to_contain_text("PLAYER_SENTINEL")
        stored_profile = page.evaluate(
            "key => JSON.parse(localStorage.getItem(key))",
            "bwedl_player_profile",
        )
        assert stored_profile["recordKey"] == "A-Klasse|9001"

        page.set_viewport_size({"width": 390, "height": 844})

        def assert_ligapokal_table_scroll(route: str, title: str) -> None:
            page.evaluate("route => { location.hash = route; }", route)
            expect(page.locator("#current-league-title")).to_contain_text(title)
            scroll_region = page.locator(
                "#league-results-container > .table-container.table-scroll"
            ).first
            expect(scroll_region).to_be_visible()
            dimensions = scroll_region.evaluate(
                "element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })"
            )
            assert dimensions["scrollWidth"] > dimensions["clientWidth"]
            scroll_region.evaluate("element => { element.scrollLeft = 80; }")
            assert scroll_region.evaluate("element => element.scrollLeft") > 0
            assert page.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth"
            )

        assert_ligapokal_table_scroll(
            "#league/Ligapokal%202026-2027",
            "Ligapokal 2026-2027",
        )
        assert_ligapokal_table_scroll(
            "#ligapokalArchive/Ligapokal%202025-2026",
            "Ligapokal 2025-2026",
        )
        page.evaluate("location.hash = '#dashboard'")
        expect(page.locator("#current-league-title")).to_have_text("Dashboard")

        dashboard_calendar = page.locator(".calendar-subscription-card--dashboard")
        expect(dashboard_calendar).to_contain_text("Malicious Club")
        dashboard_action = dashboard_calendar.get_by_role("button", name="Kalender hinzufügen")
        dashboard_action.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Teamkalender hinzufügen")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_text("Automatisch aktuell bleiben", exact=True)).to_be_visible()
        expect(dialog.get_by_text("Termine einmalig übernehmen", exact=True)).to_be_visible()
        expect(dialog.get_by_text("Keine automatische Aktualisierung", exact=False)).to_be_visible()
        assert dialog.locator("details").count() == 4
        assert dialog.evaluate("element => element.scrollWidth <= element.clientWidth")
        dashboard_webcal = dialog.get_by_role("link", name="In Kalender-App öffnen").get_attribute("href")
        assert dashboard_webcal == (
            "webcal://stats.example.test/BWEDL-Stats/calendars/club-999-team-1.ics"
        )
        copy_action = dialog.get_by_role("button", name="Abo-Link kopieren")
        expect(copy_action).to_be_focused()
        page.evaluate(
            """() => Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: async value => { window.__copiedCalendarUrl = value; } },
            })"""
        )
        copy_action.click()
        page.wait_for_function("window.__copiedCalendarUrl")
        assert page.evaluate("window.__copiedCalendarUrl") == (
            "https://stats.example.test/BWEDL-Stats/calendars/club-999-team-1.ics"
        )
        page.evaluate(
            """fixture => {
                const nativeFetch = window.fetch.bind(window);
                window.fetch = (input, options = {}) => {
                    const url = input instanceof Request ? input.url : String(input);
                    if (url !== fixture.url) return nativeFetch(input, options);
                    window.__calendarFetchOptions = {
                        cache: options.cache,
                        hasSignal: options.signal instanceof AbortSignal,
                    };
                    const response = new Response(fixture.content, {
                        status: 200,
                        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
                    });
                    Object.defineProperty(response, 'url', {
                        configurable: true,
                        value: fixture.url,
                    });
                    return Promise.resolve(response);
                };
            }""",
            {
                "url": "https://stats.example.test/BWEDL-Stats/calendars/club-999-team-1.ics",
                "content": TEST_ASSETS[TEST_CALENDAR_PATH].decode("utf-8"),
            },
        )
        download_action = dialog.get_by_role("button", name="ICS-Datei herunterladen")
        assert download_action.evaluate("element => element.getBoundingClientRect().height >= 48")
        with page.expect_download() as download_info:
            download_action.click()
        download = download_info.value
        assert page.evaluate("window.__calendarFetchOptions") == {
            "cache": "no-store",
            "hasSignal": True,
        }
        assert download.suggested_filename == "bwedl-malicious-club-zukuenftige-spiele.ics"
        download_bytes = Path(download.path()).read_bytes()
        assert download_bytes.count(b"BEGIN:VEVENT\r\n") == 1
        assert b"UID:browser-future@calendar.bwedl.invalid\r\n" in download_bytes
        assert b"UID:browser-past@calendar.bwedl.invalid\r\n" not in download_bytes
        assert b"UID:browser-cancelled@calendar.bwedl.invalid\r\n" not in download_bytes
        assert b"STATUS:CONFIRMED\r\n" in download_bytes
        expect(dialog.locator(".calendar-subscription-dialog__status")).to_have_text(
            "ICS-Datei wurde heruntergeladen."
        )
        iphone_instructions = dialog.get_by_text("Anleitung für iPhone", exact=True).first
        iphone_instructions.focus()
        page.keyboard.press("Enter")
        assert iphone_instructions.locator("xpath=..").evaluate("element => element.open")
        close_action = dialog.get_by_role("button", name="Schließen")
        close_action.scroll_into_view_if_needed()
        close_action.focus()
        expect(close_action).to_be_focused()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(dashboard_action).to_be_focused()

        page.evaluate("location.hash = '#profile'")
        profile_calendar = page.locator(".calendar-subscription-card--profile")
        expect(profile_calendar).to_contain_text("Malicious Club")
        profile_action = profile_calendar.get_by_role("button", name="Kalender hinzufügen")
        profile_action.click()
        dialog = page.get_by_role("dialog", name="Teamkalender hinzufügen")
        profile_webcal = dialog.get_by_role("link", name="In Kalender-App öffnen").get_attribute("href")
        assert profile_webcal == dashboard_webcal
        page.keyboard.press("Escape")

        malicious_club_index = page.evaluate(
            "() => window.CLUB_DATA.clubs.findIndex(club => club.name === 'Malicious Club')"
        )
        assert malicious_club_index >= 0
        page.evaluate("index => { location.hash = `#club/${index}`; }", malicious_club_index)
        expect(page.locator("#current-league-title")).to_contain_text("Malicious Club")
        page.locator("#fav-btn").click()
        expect(page.locator("#fav-section")).to_contain_text("Malicious Club")
        page.get_by_role("button", name="Navigation öffnen").click()
        clubs_disclosure = page.get_by_role("button", name="VEREINE")
        clubs_disclosure.click()
        club_shortcuts = page.locator("#club-sidebar-shortcuts")
        expect(club_shortcuts).to_contain_text("Favoriten")
        expect(club_shortcuts).to_contain_text("Malicious Club")

        assert page.get_by_role("button", name="Kalender", exact=True).count() == 0
        assert page.locator("a[download]").count() == 0

        feed_response = page.request.get(
            f"{base_url}calendars/club-999-team-1.ics",
            headers={"Cache-Control": "no-cache"},
        )
        assert feed_response.ok
        assert feed_response.body().startswith(b"BEGIN:VCALENDAR\r\n")
        assert "Ligapokal" not in feed_response.text()

        page.evaluate("location.hash = '#tools'")
        expect(page.get_by_text("Match Setup", exact=True)).to_be_visible()
        expect(page.locator("#player-list")).to_contain_text("PLAYER_SENTINEL")

        page.evaluate("location.hash = '#matchPreview'")
        expect(page.locator("#current-league-title")).to_have_text("Match Preview")
        page.locator("#match-preview-league").select_option("A-Klasse 2026-2027")
        page.locator("#match-preview-home").select_option("999")
        page.locator("#match-preview-away").select_option("996")
        expect(page.locator("#list-a .match-preview-player")).to_have_count(4)
        expect(page.locator("#list-b .match-preview-player")).to_have_count(4)
        expect(page.locator(".match-preview-evidence").first).to_contain_text("Vorjahreskader")
        page.locator(".match-preview-calculate").click()
        expect(page.locator(".match-preview-lineup")).to_have_count(2)
        for lineup in page.locator(".match-preview-lineup").all():
            expect(lineup.locator(".match-preview-lineup-slot")).to_have_count(4)
        first_forecast = page.locator(".match-preview-scores").inner_text()
        first_home_checkbox = page.locator("#list-a input[type=checkbox]").first
        first_home_checkbox.uncheck()
        page.locator(".match-preview-calculate").click()
        expect(page.locator("#preview-results")).to_contain_text(
            "Unbekannter Spieler (Klassenwert)"
        )
        assert page.locator(".match-preview-scores").inner_text() != first_forecast
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.set_viewport_size({"width": 320, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.set_viewport_size({"width": 390, "height": 844})

        assert page.locator("[data-bwedl-injected]").count() == 0
        assert page.evaluate("document.body.dataset.xss || null") is None
        assert page.get_by_text("JS Error:", exact=False).count() == 0

        page.evaluate("location.hash = '#tools'")
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
        page.evaluate(
            """() => {
                Object.defineProperty(document, 'baseURI', {
                    configurable: true,
                    value: 'https://stats.example.test/BWEDL-Stats/',
                });
                location.hash = '#dashboard';
            }"""
        )
        offline_calendar_action = page.locator(
            ".calendar-subscription-card--dashboard"
        ).get_by_role("button", name="Kalender hinzufügen")
        offline_calendar_action.click()
        expect(page.locator("#app-status")).to_have_text(
            "Für das Kalender-Abo ist eine Internetverbindung erforderlich."
        )
        assert page.locator(".calendar-subscription-dialog").count() == 0
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
