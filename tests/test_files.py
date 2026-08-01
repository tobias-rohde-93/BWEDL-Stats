import json
from pathlib import Path

from pipeline.files import content_changed, promote_file, write_json_pair


def test_write_json_pair_creates_matching_json_and_javascript(
    data_trees: tuple[Path, Path],
) -> None:
    _, staging = data_trees
    payload = {"season": "2026/27", "players": [{"name": "Jörg"}]}

    json_path, javascript_path = write_json_pair(
        staging, "ranking_data", "RANKING_DATA", payload
    )

    assert json.loads(json_path.read_text(encoding="utf-8")) == payload
    assert javascript_path.read_text(encoding="utf-8") == (
        'window.RANKING_DATA = {"season": "2026/27", '
        '"players": [{"name": "Jörg"}]};\n'
    )


def test_promote_file_replaces_destination_without_partial_content(
    data_trees: tuple[Path, Path],
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    source.write_text("new", encoding="utf-8")
    destination.write_text("old", encoding="utf-8")

    promote_file(source, destination)

    assert destination.read_text(encoding="utf-8") == "new"


def test_content_changed_reports_missing_same_and_changed_destination(
    data_trees: tuple[Path, Path],
) -> None:
    published, staging = data_trees
    source = staging / "ranking_data.json"
    destination = published / "ranking_data.json"
    source.write_bytes(b"candidate")

    assert content_changed(source, destination) is True

    destination.write_bytes(b"candidate")
    assert content_changed(source, destination) is False

    destination.write_bytes(b"published")
    assert content_changed(source, destination) is True
