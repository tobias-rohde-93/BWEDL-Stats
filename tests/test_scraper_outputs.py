import ast
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


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SCRAPER_MODULES = [
    league_scraper,
    ranking_scraper,
    club_scraper,
    archive_scraper,
    archive_tables_scraper,
]


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
