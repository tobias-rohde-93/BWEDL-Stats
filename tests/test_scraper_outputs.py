import ast
import asyncio
import inspect
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

import archive_scraper
import archive_tables_scraper
import club_scraper
import league_scraper
import ranking_scraper
from pipeline.diagnostics import AsyncDiagnosticSession, SyncDiagnosticSession
from pipeline.html_sanitizer import safe_table_fragment_issue


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SCRAPER_MODULES = [
    league_scraper,
    ranking_scraper,
    club_scraper,
    archive_scraper,
    archive_tables_scraper,
]


def test_archive_table_sub_link_requires_same_origin_archive_url() -> None:
    assert not archive_tables_scraper.is_archive_sub_link(
        "https://www.google.com/maps/place/Liga+2024-2025",
        "Liga 2024-2025",
    )
    assert archive_tables_scraper.is_archive_sub_link(
        "https://www.bwedl.de/archiv/2024-2025/abschlusstabellen/",
        "Abschlusstabellen Liga 2024-2025",
    )


def test_archive_table_season_link_requires_same_origin_archive_url() -> None:
    assert not archive_tables_scraper.is_archive_season_link(
        "https://external.example/archiv/2025-2026/",
        "Saison 2025/2026",
    )
    assert archive_tables_scraper.is_archive_season_link(
        "https://www.bwedl.de/archiv/2025-2026/",
        "Saison 2025/2026",
    )


def test_archive_table_extractor_recognizes_embedded_title() -> None:
    payload = json.dumps(
        {
            "source": archive_tables_scraper.ARCHIVE_TABLE_EXTRACTOR_JS,
            "html": (
                REPOSITORY_ROOT
                / "tests"
                / "fixtures"
                / "archive_table_embedded_title.html"
            ).read_text(encoding="utf-8"),
        }
    )
    result = subprocess.run(
        ["node", str(REPOSITORY_ROOT / "tests" / "test_archive_table_extractor.js")],
        cwd=REPOSITORY_ROOT,
        input=payload,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_archive_player_season_and_sub_links_require_same_origin() -> None:
    assert not archive_scraper.is_archive_season_link(
        "https://external.example/archiv/2025-2026/",
        "Saison 2025/2026",
    )
    assert archive_scraper.is_archive_season_link(
        "https://www.bwedl.de/archiv/2025-2026/",
        "Saison 2025/2026",
    )
    assert not archive_scraper.is_archive_sub_link(
        "https://external.example/archiv/2025-2026/ranglisten/",
        "Ranglisten 2025-2026",
    )
    assert archive_scraper.is_archive_sub_link(
        "https://www.bwedl.de/archiv/2025-2026/ranglisten/",
        "Ranglisten 2025-2026",
    )


@pytest.mark.parametrize(
    "script",
    [
        "league_scraper.py",
        "ranking_scraper.py",
        "club_scraper.py",
        "archive_scraper.py",
        "archive_tables_scraper.py",
    ],
)
def test_scraper_help_documents_candidate_output_directories(script: str) -> None:
    result = subprocess.run(
        [sys.executable, script, "--help"],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "--output-dir" in result.stdout
    assert "--artifacts-dir" in result.stdout


@pytest.mark.parametrize("module", SCRAPER_MODULES)
def test_scraper_exposes_parse_args_and_main(module) -> None:
    assert callable(getattr(module, "parse_args", None))
    assert callable(getattr(module, "main", None))


@pytest.mark.parametrize("module", SCRAPER_MODULES)
def test_scraper_parse_args_accepts_paths(module) -> None:
    args = module.parse_args(
        ["--output-dir", "candidate", "--artifacts-dir", "diagnostics"]
    )

    assert args.output_dir == Path("candidate")
    assert args.artifacts_dir == Path("diagnostics")


@pytest.mark.parametrize("module", SCRAPER_MODULES)
def test_scraper_main_parses_its_own_arguments(module) -> None:
    source = textwrap.dedent(inspect.getsource(module.main))
    tree = ast.parse(source)

    assert any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "parse_args"
        for node in ast.walk(tree)
    )


@pytest.mark.parametrize(
    ("module", "boundary_name", "is_async"),
    [
        (league_scraper, "run_scrape", False),
        (ranking_scraper, "run_scrape", False),
        (club_scraper, "run_scrape", False),
        (archive_scraper, "scrape_archive", True),
        (archive_tables_scraper, "scrape_archive_tables", True),
    ],
)
def test_scraper_main_forwards_output_and_artifacts_directories(
    monkeypatch: pytest.MonkeyPatch,
    module,
    boundary_name: str,
    is_async: bool,
) -> None:
    received = {}

    if is_async:
        async def boundary(output_dir: Path, artifacts_dir: Path) -> None:
            received["paths"] = (output_dir, artifacts_dir)
    else:
        def boundary(output_dir: Path, artifacts_dir: Path) -> None:
            received["paths"] = (output_dir, artifacts_dir)

    monkeypatch.setattr(module, boundary_name, boundary)

    module.main(
        ["--output-dir", "candidate", "--artifacts-dir", "diagnostics"]
    )

    assert received["paths"] == (Path("candidate"), Path("diagnostics"))


@pytest.mark.parametrize(
    ("module", "boundary_name", "is_async"),
    [
        (league_scraper, "run_scrape", False),
        (ranking_scraper, "run_scrape", False),
        (club_scraper, "run_scrape", False),
        (archive_scraper, "scrape_archive", True),
        (archive_tables_scraper, "scrape_archive_tables", True),
    ],
)
@pytest.mark.parametrize("boundary_status", [0, 1])
def test_scraper_main_returns_boundary_status(
    monkeypatch, module, boundary_name, is_async, boundary_status
):
    if is_async:
        async def boundary(output_dir, artifacts_dir):
            return boundary_status
    else:
        def boundary(output_dir, artifacts_dir):
            return boundary_status

    monkeypatch.setattr(module, boundary_name, boundary)

    assert module.main([]) == boundary_status


@pytest.mark.parametrize(
    ("module", "boundary_name", "is_async"),
    [
        (league_scraper, "run_scrape", False),
        (ranking_scraper, "run_scrape", False),
        (club_scraper, "run_scrape", False),
        (archive_scraper, "scrape_archive", True),
        (archive_tables_scraper, "scrape_archive_tables", True),
    ],
)
def test_scraper_main_converts_unexpected_boundary_error_to_failure_status(
    tmp_path, monkeypatch, capsys, module, boundary_name, is_async
):
    if is_async:
        async def boundary(output_dir, artifacts_dir):
            raise RuntimeError("token=do-not-log")
    else:
        def boundary(output_dir, artifacts_dir):
            raise RuntimeError("token=do-not-log")

    monkeypatch.setattr(module, boundary_name, boundary)

    assert module.main(["--artifacts-dir", str(tmp_path)]) == 1
    lines = [line for line in capsys.readouterr().out.splitlines()
             if line.startswith("SCRAPER_FAILURE ")]
    assert len(lines) == 1
    assert "do-not-log" not in lines[0]


class _Tracing:
    def __init__(self):
        self.calls = []
        self.fail_discard = False

    def start(self, **kwargs):
        self.calls.append(("start", kwargs))

    def stop(self, path=None):
        self.calls.append(("stop", path))
        if path is None and self.fail_discard:
            raise RuntimeError("trace stop failed")
        if path:
            Path(path).write_bytes(b"trace")


class _Page:
    def goto(self, *args, **kwargs):
        return None

    def locator(self, selector):
        raise RuntimeError("pre-item failure")

    def wait_for_selector(self, *args, **kwargs):
        return None

    def evaluate(self, *args, **kwargs):
        raise RuntimeError("pre-item failure")

    def content(self):
        return "<html>failure</html>"

    def screenshot(self, path, full_page):
        Path(path).write_bytes(b"png")


class _Context:
    def __init__(self):
        self.tracing = _Tracing()
        self.page = _Page()
        self.closed = False

    def new_page(self):
        return self.page

    def close(self):
        self.closed = True


class _Browser:
    def __init__(self):
        self.context = _Context()
        self.closed = False
        self.fail_context = False

    def new_context(self):
        if self.fail_context:
            raise RuntimeError("context creation failed")
        return self.context

    def close(self):
        self.closed = True


class _Playwright:
    def __init__(self):
        self.chromium = self
        self.browser = _Browser()
        self.exited = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.exited = True
        return False

    def launch(self, **kwargs):
        return self.browser


@pytest.mark.parametrize(
    ("module", "save_name"),
    [(ranking_scraper, "save_data"), (club_scraper, "save_data")],
)
def test_sync_pre_item_failure_captures_real_artifacts_and_closes_lifecycle(
    tmp_path, monkeypatch, capsys, module, save_name
):
    playwright = _Playwright()
    saved = []
    monkeypatch.setattr(module, "sync_playwright", lambda: playwright)
    monkeypatch.setattr(module, save_name, lambda *args: saved.append(args))

    assert module.main(["--artifacts-dir", str(tmp_path)]) == 1

    assert saved == []
    assert playwright.browser.context.closed
    assert playwright.browser.closed
    assert (tmp_path / f"{Path(module.__file__).stem}.html").is_file()
    assert (tmp_path / f"{Path(module.__file__).stem}.png").is_file()
    assert (tmp_path / f"{Path(module.__file__).stem}-trace.zip").is_file()
    assert len([line for line in capsys.readouterr().out.splitlines()
                if line.startswith("SCRAPER_FAILURE ")]) == 1


class _AsyncTracing(_Tracing):
    async def start(self, **kwargs):
        return super().start(**kwargs)

    async def stop(self, path=None):
        return super().stop(path)


class _AsyncPage(_Page):
    async def goto(self, *args, **kwargs):
        return None

    async def evaluate(self, *args, **kwargs):
        raise RuntimeError("pre-item failure")

    async def content(self):
        return "<html>failure</html>"

    async def screenshot(self, path, full_page):
        Path(path).write_bytes(b"png")


class _AsyncContext(_Context):
    def __init__(self):
        self.tracing = _AsyncTracing()
        self.page = _AsyncPage()
        self.closed = False

    async def new_page(self):
        return self.page

    async def close(self):
        self.closed = True


class _AsyncBrowser(_Browser):
    def __init__(self):
        self.context = _AsyncContext()
        self.closed = False
        self.fail_context = False

    async def new_context(self):
        if self.fail_context:
            raise RuntimeError("context creation failed")
        return self.context

    async def close(self):
        self.closed = True


class _AsyncPlaywright(_Playwright):
    def __init__(self):
        self.chromium = self
        self.browser = _AsyncBrowser()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.exited = True
        return False

    async def launch(self, **kwargs):
        return self.browser


@pytest.mark.parametrize(
    ("module", "save_name"),
    [
        (archive_scraper, "save_archive_data"),
        (archive_tables_scraper, "save_archive_tables"),
    ],
)
def test_async_pre_item_failure_captures_real_artifacts_and_closes_lifecycle(
    tmp_path, monkeypatch, capsys, module, save_name
):
    playwright = _AsyncPlaywright()
    saved = []
    monkeypatch.setattr(module, "async_playwright", lambda: playwright)
    monkeypatch.setattr(module, save_name, lambda *args: saved.append(args))

    assert module.main(["--artifacts-dir", str(tmp_path)]) == 1

    assert saved == []
    assert playwright.browser.context.closed
    assert playwright.browser.closed
    assert (tmp_path / f"{Path(module.__file__).stem}.html").is_file()
    assert (tmp_path / f"{Path(module.__file__).stem}.png").is_file()
    assert (tmp_path / f"{Path(module.__file__).stem}-trace.zip").is_file()
    assert len([line for line in capsys.readouterr().out.splitlines()
                if line.startswith("SCRAPER_FAILURE ")]) == 1


def test_sync_trace_stop_failure_is_captured_and_all_resources_close(
    tmp_path, capsys
):
    playwright = _Playwright()
    playwright.browser.context.tracing.fail_discard = True
    session = SyncDiagnosticSession(lambda: playwright, tmp_path, "sync_post")

    with session:
        pass

    assert isinstance(session.error, RuntimeError)
    assert playwright.browser.context.closed
    assert playwright.browser.closed
    assert (tmp_path / "sync_post-trace.zip").is_file()
    assert len([line for line in capsys.readouterr().out.splitlines()
                if line.startswith("SCRAPER_FAILURE ")]) == 1


def test_async_trace_stop_failure_is_captured_and_all_resources_close(
    tmp_path, capsys
):
    playwright = _AsyncPlaywright()
    playwright.browser.context.tracing.fail_discard = True
    session = AsyncDiagnosticSession(lambda: playwright, tmp_path, "async_post")

    async def run():
        async with session:
            pass

    asyncio.run(run())

    assert isinstance(session.error, RuntimeError)
    assert playwright.browser.context.closed
    assert playwright.browser.closed
    assert (tmp_path / "async_post-trace.zip").is_file()
    assert len([line for line in capsys.readouterr().out.splitlines()
                if line.startswith("SCRAPER_FAILURE ")]) == 1


@pytest.mark.parametrize("is_async", [False, True])
def test_context_creation_failure_unwinds_browser_and_playwright_without_fake_paths(
    tmp_path, capsys, is_async
):
    playwright = _AsyncPlaywright() if is_async else _Playwright()
    playwright.browser.fail_context = True
    session = (
        AsyncDiagnosticSession(lambda: playwright, tmp_path, "enter_failure")
        if is_async
        else SyncDiagnosticSession(lambda: playwright, tmp_path, "enter_failure")
    )

    if is_async:
        async def run():
            async with session:
                pass
        with pytest.raises(RuntimeError, match="context creation failed"):
            asyncio.run(run())
    else:
        with pytest.raises(RuntimeError, match="context creation failed"):
            with session:
                pass

    assert playwright.browser.closed
    assert playwright.exited
    assert not list(tmp_path.iterdir())
    assert capsys.readouterr().out == ""


class _EmptyLocator:
    def all(self):
        return []


class _EmptyOverviewPage(_Page):
    def locator(self, selector):
        return _EmptyLocator()


@pytest.mark.parametrize(
    ("module", "save_name"),
    [(league_scraper, "save_data"), (club_scraper, "save_data")],
)
def test_empty_structural_overview_fails_with_artifacts_and_without_save(
    tmp_path, monkeypatch, module, save_name
):
    playwright = _Playwright()
    playwright.browser.context.page = _EmptyOverviewPage()
    saved = []
    monkeypatch.setattr(module, "sync_playwright", lambda: playwright)
    monkeypatch.setattr(module, save_name, lambda *args: saved.append(args))

    assert module.main(["--artifacts-dir", str(tmp_path)]) == 1
    assert saved == []
    assert list(tmp_path.glob("*.html"))
    assert list(tmp_path.glob("*-trace.zip"))


def test_empty_ranking_overview_is_valid_candidate_for_validator_retain(
    tmp_path, monkeypatch
):
    playwright = _Playwright()
    playwright.browser.context.page = _EmptyOverviewPage()
    saved = []
    monkeypatch.setattr(ranking_scraper, "sync_playwright", lambda: playwright)
    monkeypatch.setattr(ranking_scraper, "save_data", lambda data, output: saved.append(data))

    assert ranking_scraper.main(["--artifacts-dir", str(tmp_path)]) == 0
    assert saved == [{"last_updated": "", "rankings": {}, "players": []}]
    assert not list(tmp_path.iterdir())


class _RankingCategoryLink:
    def __init__(self, name: str):
        self.name = name

    def get_attribute(self, attribute: str):
        assert attribute == "href"
        return f"/ranglisten/{self.name.casefold().replace(' ', '-')}/"

    def inner_text(self):
        return self.name


class _RankingCategoryLinks:
    def all(self):
        return [
            _RankingCategoryLink(name)
            for name in ("Bezirksliga", "A-Klasse", "B-Klasse", "C-Klasse")
        ]


class _NoRankingTable:
    def count(self):
        return 0


class _EmptyRankingCategoriesPage(_Page):
    def locator(self, selector):
        if selector == "a[href*='/ranglisten/']":
            return _RankingCategoryLinks()
        if selector == "div.table-responsive table":
            return _NoRankingTable()
        raise AssertionError(selector)


def test_ranking_categories_without_tables_save_empty_candidate(
    tmp_path, monkeypatch
):
    playwright = _Playwright()
    playwright.browser.context.page = _EmptyRankingCategoriesPage()
    saved = []
    monkeypatch.setattr(ranking_scraper, "sync_playwright", lambda: playwright)
    monkeypatch.setattr(
        ranking_scraper,
        "save_data",
        lambda data, output: saved.append((data, output)),
    )
    output_dir = tmp_path / "candidate"
    artifacts_dir = tmp_path / "artifacts"

    assert ranking_scraper.run_scrape(output_dir, artifacts_dir) == 0
    assert saved == [
        (
            {
                "last_updated": "",
                "rankings": {
                    "Bezirksliga": "",
                    "A-Klasse": "",
                    "B-Klasse": "",
                    "C-Klasse": "",
                },
                "players": [],
            },
            output_dir,
        )
    ]
    assert not artifacts_dir.exists()


def test_league_initialization_does_not_read_published_data_for_candidate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    published_payload = {
        "leagues": {"sentinel": {"table": "published"}},
        "last_updated": "old",
    }
    Path("league_data.json").write_text(
        json.dumps(published_payload), encoding="utf-8"
    )
    output_dir = tmp_path / "candidate"

    candidate = league_scraper.load_data(output_dir)

    assert candidate == {"leagues": {}, "last_updated": ""}


@pytest.mark.parametrize(
    ("module", "helper_name", "filename", "global_name", "current_payload"),
    [
        (
            archive_scraper,
            "save_archive_data",
            "archive_data.js",
            "ARCHIVE_DATA",
            {"current-player": [{"season": "26/27"}]},
        ),
        (
            archive_tables_scraper,
            "save_archive_tables",
            "archive_tables.js",
            "ARCHIVE_TABLES",
            [{"season": "26/27", "league": "Current"}],
        ),
    ],
)
def test_archive_save_writes_only_current_candidate_data(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    module,
    helper_name: str,
    filename: str,
    global_name: str,
    current_payload,
) -> None:
    monkeypatch.chdir(tmp_path)
    sentinel_content = f'window.{global_name} = {{"sentinel": true}};\n'
    public_path = tmp_path / filename
    public_path.write_text(sentinel_content, encoding="utf-8")
    output_dir = tmp_path / "candidate"

    candidate_path = getattr(module, helper_name)(current_payload, output_dir)

    assert public_path.read_text(encoding="utf-8") == sentinel_content
    assert candidate_path == output_dir / filename
    candidate_content = candidate_path.read_text(encoding="utf-8")
    prefix = f"window.{global_name} = "
    assert json.loads(candidate_content.removeprefix(prefix).removesuffix(";\n")) == (
        current_payload
    )


@pytest.mark.parametrize(
    ("save_data", "stem", "global_name"),
    [
        (league_scraper.save_data, "league_data", "LEAGUE_DATA"),
        (ranking_scraper.save_data, "ranking_data", "RANKING_DATA"),
        (club_scraper.save_data, "club_data", "CLUB_DATA"),
    ],
)
def test_json_scraper_save_data_writes_only_to_output_directory(
    tmp_path: Path,
    save_data,
    stem: str,
    global_name: str,
) -> None:
    output_dir = tmp_path / "candidate"
    payload = {"items": [{"name": "Jörg"}]}

    json_path, javascript_path = save_data(payload, output_dir)

    assert json_path == output_dir / f"{stem}.json"
    assert javascript_path == output_dir / f"{stem}.js"
    assert json_path.is_file()
    assert javascript_path.read_text(encoding="utf-8").startswith(
        f"window.{global_name} = "
    )
    assert not (tmp_path / f"{stem}.json").exists()
    assert not (tmp_path / f"{stem}.js").exists()


class _UnsafeTableLocator:
    def __init__(self, html: str):
        self.html = html

    @property
    def first(self):
        return self

    def count(self):
        return 1

    def evaluate(self, script: str):
        assert "outerHTML" in script
        return self.html


class _SingleOption:
    def get_attribute(self, attribute: str):
        assert attribute == "value"
        return "1"

    def inner_text(self):
        return "1. Spieltag"


class _OptionCollection:
    def all(self):
        return [_SingleOption()]


class _StandardLeagueSelect:
    def count(self):
        return 1

    def locator(self, selector: str):
        assert selector == "option"
        return _OptionCollection()

    def select_option(self, value: str):
        assert value == "1"


class _TextareaLocator:
    def count(self):
        return 1


class _UnsafeStandardLeaguePage(_Page):
    def __init__(self):
        self.table = _UnsafeTableLocator(
            "<table class='source'><tr><td onclick='run()'>"
            "Team<script>run()</script></td></tr></table>"
        )

    def locator(self, selector: str):
        if selector == 'select[name="wtWahl"]':
            return _StandardLeagueSelect()
        if selector == "xpath=//table[contains(., 'Pl.')]":
            return self.table
        if selector == "textarea":
            return _TextareaLocator()
        raise AssertionError(selector)

    def evaluate(self, script: str, *args):
        assert "querySelector('textarea').value" in script
        return "---"

    def wait_for_timeout(self, milliseconds: int):
        assert milliseconds == 2000


def test_standard_league_table_is_sanitized_immediately_after_capture() -> None:
    data = {"leagues": {}}

    league_scraper.scrape_league(
        _UnsafeStandardLeaguePage(),
        "https://www.bwedl.de/tabellen/test/",
        "Testliga 2026-2027",
        data,
    )

    table = data["leagues"]["Testliga 2026-2027"]["table"]
    assert safe_table_fragment_issue(table) is None
    assert table == "<table><tr><td>Team</td></tr></table>"


class _NoLeagueSelect:
    def count(self):
        return 0


class _NoTables:
    def all(self):
        return []


class _UnsafeCupPage(_Page):
    def locator(self, selector: str):
        if selector == 'select[name="wtWahl"]':
            return _NoLeagueSelect()
        if selector == "table":
            return _NoTables()
        raise AssertionError(selector)

    def evaluate(self, script: str, *args):
        assert "fullHtmlParts" in script
        return {
            "html": (
                "<h3>Runde 1</h3><table onclick='run()'><tr><td>Eins</td></tr></table>"
                "<script>run()</script><h3>Finale</h3>"
                "<table><tr><td><img src=x onerror='run()'>Zwei</td></tr></table>"
            ),
            "rounds": [
                {"name": "Runde 1", "text": "Mo. 24. 8.2026 Team A - Team B 0:0"},
                {"name": "Finale", "text": "Mo. 31. 8.2026 Team C - Team D 0:0"},
            ],
        }


def test_ligapokal_multi_table_fragment_is_sanitized_without_source_headings() -> None:
    data = {"leagues": {}}

    league_scraper.scrape_league(
        _UnsafeCupPage(),
        "https://www.bwedl.de/tabellen/ligapokal/",
        "Ligapokal 2026-2027",
        data,
    )

    league = data["leagues"]["Ligapokal 2026-2027"]
    assert safe_table_fragment_issue(league["table"]) is None
    assert league["table"] == (
        "<table><tr><td>Eins</td></tr></table>"
        "<table><tr><td>Zwei</td></tr></table>"
    )
    assert list(league["match_days"]) == ["Runde 1", "Finale"]


class _OneRankingLink(_RankingCategoryLink):
    pass


class _OneRankingLinks:
    def all(self):
        return [_OneRankingLink("Bezirksliga")]


class _UnsafeRankingPage(_Page):
    def __init__(self):
        self.table = _UnsafeTableLocator(
            "<table style='color:red'><tr><td onerror='run()'>"
            "Spieler<script>run()</script></td></tr></table>"
        )

    def locator(self, selector: str):
        if selector == "a[href*='/ranglisten/']":
            return _OneRankingLinks()
        if selector == "div.table-responsive table":
            return self.table
        raise AssertionError(selector)

    def evaluate(self, script: str, league_name: str):
        assert league_name == "Bezirksliga"
        assert "category_players" not in script
        return [
            {
                "v_nr": "001",
                "id": "1",
                "name": "Spieler Eins",
                "rank": "1",
                "points": "10",
                "league": league_name,
                "rounds": {},
            }
        ]


def test_ranking_table_is_sanitized_before_candidate_save(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    playwright = _Playwright()
    playwright.browser.context.page = _UnsafeRankingPage()
    saved = []
    monkeypatch.setattr(ranking_scraper, "sync_playwright", lambda: playwright)
    monkeypatch.setattr(
        ranking_scraper,
        "save_data",
        lambda data, output: saved.append((data, output)),
    )

    assert ranking_scraper.run_scrape(tmp_path / "candidate", tmp_path / "artifacts") == 0

    candidate = saved[0][0]
    table = candidate["rankings"]["Bezirksliga"]
    assert safe_table_fragment_issue(table) is None
    assert table == "<table><tr><td>Spieler</td></tr></table>"
