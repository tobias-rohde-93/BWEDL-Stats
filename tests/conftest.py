import json
from pathlib import Path

import pytest


@pytest.fixture
def data_trees(tmp_path: Path) -> tuple[Path, Path]:
    published = tmp_path / "published"
    staging = tmp_path / "staging"
    published.mkdir()
    staging.mkdir()
    return published, staging


@pytest.fixture
def prior_rankings() -> dict:
    return {
        "season": "2025/26",
        "last_updated": "01.08.2026 12:00:00",
        "rankings": {
            "Bezirksliga": "<table><tr><td>Marco Merz</td></tr></table>",
            "A-Klasse": "<table><tr><td>Anna A</td></tr></table>",
            "B-Klasse": "<table><tr><td>Bernd B</td></tr></table>",
            "C-Klasse": "<table><tr><td>Clara C</td></tr></table>",
        },
        "players": [
            {"id": "1", "name": "Marco Merz", "league": "Bezirksliga"},
            {"id": "2", "name": "Anna A", "league": "A-Klasse"},
            {"id": "3", "name": "Bernd B", "league": "B-Klasse"},
            {"id": "4", "name": "Clara C", "league": "C-Klasse"},
        ],
    }


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
