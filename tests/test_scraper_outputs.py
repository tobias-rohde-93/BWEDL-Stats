import subprocess
import sys
from pathlib import Path

import pytest

import club_scraper
import league_scraper
import ranking_scraper


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


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

    save_data(payload, output_dir)

    assert (output_dir / f"{stem}.json").is_file()
    assert (output_dir / f"{stem}.js").read_text(encoding="utf-8").startswith(
        f"window.{global_name} = "
    )
    assert not (tmp_path / f"{stem}.json").exists()
    assert not (tmp_path / f"{stem}.js").exists()
