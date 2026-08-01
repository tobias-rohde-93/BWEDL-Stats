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


def test_promote_file_removes_only_owned_temp_when_copy_fails(
    data_trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    sentinel = destination.with_suffix(destination.suffix + ".next")
    source.write_text("new", encoding="utf-8")
    destination.write_text("old", encoding="utf-8")
    sentinel.write_text("sentinel", encoding="utf-8")
    copied_to: list[Path] = []

    def fail_copy(_source: Path, target: Path) -> None:
        copied_to.append(target)
        target.write_text("partial", encoding="utf-8")
        raise OSError("copy failed")

    monkeypatch.setattr(file_module.shutil, "copyfile", fail_copy)

    with pytest.raises(OSError, match="copy failed"):
        promote_file(source, destination)

    assert destination.read_text(encoding="utf-8") == "old"
    assert sentinel.read_text(encoding="utf-8") == "sentinel"
    assert len(copied_to) == 1
    assert not copied_to[0].exists()


def test_promote_file_removes_only_owned_temp_when_replace_fails(
    data_trees: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    sentinel = destination.with_suffix(destination.suffix + ".next")
    source.write_text("new", encoding="utf-8")
    destination.write_text("old", encoding="utf-8")
    sentinel.write_text("sentinel", encoding="utf-8")
    replaced_from: list[Path] = []

    def fail_replace(temporary: Path, _destination: Path) -> None:
        replaced_from.append(temporary)
        raise OSError("replace failed")

    monkeypatch.setattr(file_module.os, "replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        promote_file(source, destination)

    assert destination.read_text(encoding="utf-8") == "old"
    assert sentinel.read_text(encoding="utf-8") == "sentinel"
    assert len(replaced_from) == 1
    assert not replaced_from[0].exists()


def test_promote_file_preserves_predictable_collision_paths(
    data_trees: tuple[Path, Path],
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    next_collision = destination.with_suffix(destination.suffix + ".next")
    rollback_collision = destination.with_suffix(destination.suffix + ".rollback")
    source.write_text("new", encoding="utf-8")
    next_collision.mkdir()
    rollback_collision.write_text("sentinel", encoding="utf-8")

    promote_file(source, destination)

    assert destination.read_text(encoding="utf-8") == "new"
    assert next_collision.is_dir()
    assert rollback_collision.read_text(encoding="utf-8") == "sentinel"


@pytest.mark.parametrize("invalid_source", ["directory", "missing"])
def test_promote_file_rejects_non_regular_source(
    data_trees: tuple[Path, Path], invalid_source: str
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    destination.write_text("old", encoding="utf-8")
    if invalid_source == "directory":
        source.mkdir()

    with pytest.raises((FileNotFoundError, ValueError), match="source"):
        promote_file(source, destination)

    assert destination.read_text(encoding="utf-8") == "old"


def test_promote_file_rejects_non_regular_destination(
    data_trees: tuple[Path, Path],
) -> None:
    published, staging = data_trees
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    source.write_text("new", encoding="utf-8")
    destination.mkdir()

    with pytest.raises(ValueError, match="destination"):
        promote_file(source, destination)

    assert destination.is_dir()


def _symlink_or_skip(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target)
    except OSError as error:
        pytest.skip(f"symlinks unavailable: {error}")


@pytest.mark.parametrize("link_kind", ["source", "destination"])
def test_promote_file_rejects_symlink_paths_without_following_them(
    data_trees: tuple[Path, Path], link_kind: str
) -> None:
    published, staging = data_trees
    real_source = staging / "real-source.json"
    source = staging / "league_data.json"
    destination = published / "league_data.json"
    real_destination = published / "real-destination.json"
    real_source.write_text("new", encoding="utf-8")
    real_destination.write_text("old", encoding="utf-8")
    if link_kind == "source":
        _symlink_or_skip(source, real_source)
        destination.write_text("destination", encoding="utf-8")
    else:
        source.write_text("new", encoding="utf-8")
        _symlink_or_skip(destination, real_destination)

    with pytest.raises(ValueError, match=link_kind):
        promote_file(source, destination)

    assert real_source.read_text(encoding="utf-8") == "new"
    assert real_destination.read_text(encoding="utf-8") == "old"


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
