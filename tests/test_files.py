import json
from pathlib import Path

import pytest

import pipeline.files as file_module
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
    assert json_path.read_bytes() == (
        b'{\n  "season": "2026/27",\n  "players": [\n'
        b'    {\n      "name": "J\xc3\xb6rg"\n    }\n  ]\n}\n'
    )
    assert javascript_path.read_bytes() == (
        b'window.RANKING_DATA = {"season": "2026/27", '
        b'"players": [{"name": "J\xc3\xb6rg"}]};\n'
    )
    assert b"\r\n" not in json_path.read_bytes()
    assert b"\r\n" not in javascript_path.read_bytes()


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


def test_promote_file_removes_partial_next_file_when_copy_fails(
    data_trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    next_path = destination.with_suffix(destination.suffix + ".next")
    source.write_text("new", encoding="utf-8")
    destination.write_text("old", encoding="utf-8")

    def fail_copy(_source: Path, target: Path) -> None:
        target.write_text("partial", encoding="utf-8")
        raise OSError("copy failed")

    monkeypatch.setattr(file_module.shutil, "copyfile", fail_copy)

    with pytest.raises(OSError, match="copy failed"):
        promote_file(source, destination)

    assert destination.read_text(encoding="utf-8") == "old"
    assert not next_path.exists()


def test_promote_file_removes_next_file_when_replace_fails(
    data_trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    next_path = destination.with_suffix(destination.suffix + ".next")
    source.write_text("new", encoding="utf-8")
    destination.write_text("old", encoding="utf-8")

    def fail_replace(_source: Path, _destination: Path) -> None:
        raise OSError("replace failed")

    monkeypatch.setattr(file_module.os, "replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        promote_file(source, destination)

    assert destination.read_text(encoding="utf-8") == "old"
    assert not next_path.exists()


def test_promote_file_creates_missing_destination_parent(
    data_trees: tuple[Path, Path],
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "nested" / "league_data.json"
    source.write_text("new", encoding="utf-8")

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
