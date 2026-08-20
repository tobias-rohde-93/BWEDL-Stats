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


def test_live_archive_headers_keep_stable_id_and_separate_surname(
    fixture: dict,
) -> None:
    record = parse_archive_ranking_table(**fixture["live_2025_2026"])[0]

    assert record == {
        "id": "4711",
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


def test_combining_archive_name_is_normalized_to_nfc(fixture: dict) -> None:
    record = parse_archive_ranking_table(**fixture["combining_name"])[0]

    assert record["name"] == "José Müller"


@pytest.mark.parametrize("player_id", ["47A1", "٤٧١١"])
def test_archive_player_id_requires_ascii_digits(
    fixture: dict,
    player_id: str,
) -> None:
    table = deepcopy(fixture["modern"])
    table["rows"][0][2] = player_id

    with pytest.raises(ArchivePlayerParseError, match="player id"):
        parse_archive_ranking_table(**table)


def test_archive_club_number_requires_ascii_digits(fixture: dict) -> None:
    table = deepcopy(fixture["modern"])
    table["rows"][0][1] = "01A"

    with pytest.raises(ArchivePlayerParseError, match="club number"):
        parse_archive_ranking_table(**table)


def test_archive_player_name_requires_a_unicode_letter(fixture: dict) -> None:
    table = deepcopy(fixture["totals_only"])
    table["rows"][0][2] = "123 456"

    with pytest.raises(ArchivePlayerParseError, match="player name"):
        parse_archive_ranking_table(**table)


def test_unicode_player_name_and_leading_zero_id_are_preserved(fixture: dict) -> None:
    table = deepcopy(fixture["totals_only"])
    table["rows"][0][1] = "00811"
    table["rows"][0][2] = "李 雷"

    record = parse_archive_ranking_table(**table)[0]

    assert record["id"] == "00811"
    assert record["name"] == "李 雷"


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


@pytest.mark.parametrize("header", ["R", "Runde", "Runde X", "R1x"])
def test_round_like_header_without_valid_number_is_rejected(
    fixture: dict,
    header: str,
) -> None:
    table = deepcopy(fixture["suspicious_round_header"])
    table["headers"][5] = header

    with pytest.raises(ArchivePlayerParseError, match="round header"):
        parse_archive_ranking_table(**table)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (None, ""),
        ("", ""),
        (" X ", "X"),
        (" VW ", "VW"),
        ("Vw", "Vw"),
        ("D", "D"),
        ("d", "d"),
        ("kp", "kp"),
        ("*", "*"),
        (0, 0),
        ("0", 0),
        ("12", 12),
    ],
)
def test_round_values_preserve_observed_marker_spelling(source, expected) -> None:
    assert parse_round_value(source) == expected


@pytest.mark.parametrize("source", ["?", "-1", "not played"])
def test_unknown_round_markers_are_rejected_with_source_value(source: str) -> None:
    with pytest.raises(ArchivePlayerParseError, match="invalid round value") as error:
        parse_round_value(source)

    assert repr(source.strip()) in str(error.value)


def test_observed_markers_do_not_count_but_numeric_zero_is_an_appearance(
    fixture: dict,
) -> None:
    record = parse_archive_ranking_table(**fixture["administrative_markers"])[0]

    assert record["rounds"] == {
        "R1": "x", "R2": "VW", "R3": "Vw", "R4": "D", "R5": "d",
        "R6": "kp", "R7": "*", "R8": 0, "R9": "",
    }
    assert record["appearances"] == 1
    assert record["points_per_appearance"] == 0.0


def test_unknown_marker_error_identifies_the_round(fixture: dict) -> None:
    with pytest.raises(ArchivePlayerParseError, match=r"round R1:.*'\?'"):
        parse_archive_ranking_table(**fixture["unknown_marker"])


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
        {"id": "20", "season": "2023/2024", "rank": 2, "points": 4,
         "league": "B-Klasse", "name": "Twenty"},
        {"id": "100", "season": "2025/2026", "rank": 1, "points": 8,
         "league": "A-Klasse", "name": "Hundred"},
        {"id": "20", "season": "2025/2026", "rank": 3, "points": 6,
         "league": "A-Klasse", "name": "Twenty"},
    ]
    original = deepcopy(entries)

    merged = merge_archive_entries(entries)

    assert list(merged) == ["100", "20"]
    assert [entry["season"] for entry in merged["20"]] == [
        "2025/2026",
        "2023/2024",
    ]
    assert all(len(entry["segments"]) == 1 for history in merged.values() for entry in history)
    assert all(entry["primary_segment_id"].startswith("sha256:")
               for history in merged.values() for entry in history)
    assert all("id" not in entry for history in merged.values() for entry in history)
    assert entries == original


def test_same_season_class_segments_are_preserved_in_one_container(
    fixture: dict,
) -> None:
    entries = [
        *parse_archive_ranking_table(**fixture["multi_class_bezirksliga"]),
        *parse_archive_ranking_table(**fixture["multi_class_a"]),
    ]

    result = merge_archive_entries(entries)
    container = result["1416"][0]

    assert container["season"] == "2025/2026"
    assert container["points"] == 55
    assert container["rank"] == 11
    assert container["league"] == "A-Klasse"
    assert container["name"] == "Ingo Eichenhofer"
    assert len(container["segments"]) == 2
    assert {segment["league"] for segment in container["segments"]} == {
        "Bezirksliga", "A-Klasse",
    }
    assert all(segment["segment_id"].startswith("sha256:")
               for segment in container["segments"])
    assert not {"v_nr", "rounds", "appearances", "points_per_appearance"} & container.keys()


def test_segment_order_and_ids_are_deterministic_and_inputs_are_not_mutated(
    fixture: dict,
) -> None:
    entries = [
        *parse_archive_ranking_table(**fixture["multi_class_bezirksliga"]),
        *parse_archive_ranking_table(**fixture["multi_class_a"]),
    ]
    original = deepcopy(entries)

    forward = merge_archive_entries(entries)
    reverse = merge_archive_entries(reversed(entries))

    assert forward == reverse
    assert entries == original


def test_exact_semantic_segment_collision_is_rejected() -> None:
    entry = {
        "id": "4711", "season": "2025/2026", "rank": 2, "points": 4,
        "league": "A-Klasse", "name": "Same Segment",
    }

    with pytest.raises(ArchivePlayerParseError, match="segment.*collision"):
        merge_archive_entries([entry, dict(entry)])


def test_name_conflict_preserves_segments_and_marks_only_the_season_ambiguous() -> None:
    entries = [
        {"id": "9", "season": "2025/2026", "rank": 1, "points": 5,
         "league": "A-Klasse", "name": "Alpha Name"},
        {"id": "9", "season": "2025/2026", "rank": 2, "points": 4,
         "league": "B-Klasse", "name": "Beta Name"},
        {"id": "9", "season": "2024/2025", "rank": 3, "points": 3,
         "league": "B-Klasse", "name": "Alpha Name"},
    ]

    history = merge_archive_entries(entries)["9"]

    assert history[0]["identity_ambiguous"] is True
    assert {segment["name"] for segment in history[0]["segments"]} == {
        "Alpha Name", "Beta Name",
    }
    assert "identity_ambiguous" not in history[1]


def test_same_class_club_conflicting_rounds_are_marked_without_data_loss() -> None:
    base = {
        "id": "10", "season": "2025/2026", "league": "A-Klasse",
        "name": "Transfer Player", "v_nr": "035",
    }
    first = {**base, "rank": 3, "points": 3, "rounds": {"R1": 3},
             "appearances": 1, "points_per_appearance": 3.0}
    second = {**base, "rank": 4, "points": 4, "rounds": {"R1": 4},
              "appearances": 1, "points_per_appearance": 4.0}

    container = merge_archive_entries([first, second])["10"][0]

    assert container["round_overlap_ambiguous"] is True
    assert len(container["segments"]) == 2


def test_same_class_transfer_keeps_both_clubs_without_round_overlap() -> None:
    entries = [
        {"id": "11", "season": "2025/2026", "rank": 3, "points": 3,
         "league": "A-Klasse", "name": "Moved Player", "v_nr": "035",
         "rounds": {"R1": 3}, "appearances": 1, "points_per_appearance": 3.0},
        {"id": "11", "season": "2025/2026", "rank": 4, "points": 4,
         "league": "A-Klasse", "name": "Moved Player", "v_nr": "043",
         "rounds": {"R1": 4}, "appearances": 1, "points_per_appearance": 4.0},
    ]

    container = merge_archive_entries(entries)["11"][0]

    assert {segment["v_nr"] for segment in container["segments"]} == {"035", "043"}
    assert "round_overlap_ambiguous" not in container


def test_container_point_sum_must_remain_javascript_safe() -> None:
    entries = [
        {"id": "12", "season": "2025/2026", "rank": 1,
         "points": 2**53 - 1, "league": "A-Klasse", "name": "Huge"},
        {"id": "12", "season": "2025/2026", "rank": 2,
         "points": 1, "league": "B-Klasse", "name": "Huge"},
    ]

    with pytest.raises(ArchivePlayerParseError, match="safe integer"):
        merge_archive_entries(entries)


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
