from copy import deepcopy
import json
from pathlib import Path

import pytest

from pipeline.archive_players import (
    ROUND_HEADER,
    ArchivePlayerParseError,
    locate_archive_columns,
    merge_archive_entries,
    parse_archive_player_row,
    parse_archive_ranking_table,
    parse_round_value,
)


@pytest.fixture
def fixture() -> dict:
    path = Path(__file__).parent / "fixtures" / "archive_ranking_players.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_modern_archive_row_keeps_round_evidence(fixture: dict) -> None:
    source = deepcopy(fixture["modern"])

    record = parse_archive_ranking_table(**fixture["modern"])[0]
    player_id = record.pop("id")

    assert player_id == "4711"
    assert record == {
        "season": "2025/2026",
        "rank": 35,
        "points": 12,
        "league": "A-Klasse",
        "name": "Mario Ackermann",
        "v_nr": "018",
        "rounds": {"R1": 5, "R2": "x", "R3": 7},
        "appearances": 2,
        "points_per_appearance": 6.0,
    }
    assert fixture["modern"] == source


def test_combining_archive_name_is_normalized_to_nfc(fixture: dict) -> None:
    record = parse_archive_ranking_table(**fixture["combining_name"])[0]

    assert record["name"] == "José Müller"


def test_total_only_archive_row_remains_career_only(fixture: dict) -> None:
    record = parse_archive_ranking_table(**fixture["totals_only"])[0]

    assert record == {
        "id": "811",
        "season": "2020/2022",
        "rank": 9,
        "points": 21,
        "league": "C-Klasse",
        "name": "Legacy Spieler",
    }
    assert not {"rounds", "appearances", "points_per_appearance"} & record.keys()


def test_complete_round_sequence_must_match_total(fixture: dict) -> None:
    with pytest.raises(ArchivePlayerParseError, match="round total"):
        parse_archive_ranking_table(**fixture["inconsistent"])


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (None, ""),
        ("", ""),
        (" X ", "x"),
        (0, 0),
        ("0", 0),
        ("12", 12),
        ("-1", ""),
        ("not played", ""),
    ],
)
def test_round_values_only_keep_nonnegative_numbers_and_x(source, expected) -> None:
    assert parse_round_value(source) == expected


def test_header_aliases_drive_combined_name_and_canonical_rounds() -> None:
    headers = ["Platz", "V-Nr.", "ID", "Name", "Runde 1", "R2", "Gesamt"]
    columns = locate_archive_columns(headers)

    record = parse_archive_player_row(
        "2022/2023",
        "Bezirksliga",
        columns,
        ["2", "007", "42", "Ada Lovelace", "3", "", "3"],
    )

    assert ROUND_HEADER.fullmatch("Runde 1")
    assert record == {
        "id": "42",
        "season": "2022/2023",
        "rank": 2,
        "points": 3,
        "league": "Bezirksliga",
        "name": "Ada Lovelace",
        "v_nr": "007",
        "rounds": {"R1": 3, "R2": ""},
        "appearances": 1,
        "points_per_appearance": 3.0,
    }


def test_merge_archive_entries_is_sorted_and_does_not_mutate_inputs() -> None:
    entries = [
        {"id": "20", "season": "2023/2024", "league": "B-Klasse"},
        {"id": "100", "season": "2025/2026", "league": "A-Klasse"},
        {"id": "20", "season": "2025/2026", "league": "A-Klasse"},
    ]
    original = deepcopy(entries)

    merged = merge_archive_entries(entries)

    assert list(merged) == ["100", "20"]
    assert [entry["season"] for entry in merged["20"]] == [
        "2025/2026",
        "2023/2024",
    ]
    assert all("id" not in entry for history in merged.values() for entry in history)
    assert entries == original


def test_duplicate_player_season_is_rejected() -> None:
    entry = {"id": "4711", "season": "2025/2026", "league": "A-Klasse"}

    with pytest.raises(ArchivePlayerParseError, match="duplicate"):
        merge_archive_entries([entry, dict(entry)])


@pytest.mark.parametrize(
    "entry",
    [
        {"id": "", "season": "2025/2026"},
        {"id": "4711", "season": ""},
    ],
)
def test_blank_player_season_identity_is_rejected(entry: dict) -> None:
    with pytest.raises(ArchivePlayerParseError, match="blank"):
        merge_archive_entries([entry])
