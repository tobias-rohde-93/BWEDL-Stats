from copy import deepcopy
import json
from typing import Any

import pytest

import pipeline.validation as validation
from pipeline.archive_players import merge_archive_entries
from pipeline.validation import Decision, ValidationResult, validate_rankings


REQUIRED_CATEGORIES = (
    "Bezirksliga",
    "A-Klasse",
    "B-Klasse",
    "C-Klasse",
)

REGULAR_LEAGUES = (
    "Bezirksliga",
    "A-Klasse Gruppe 1",
    "A-Klasse Gruppe 2",
    "B-Klasse Gruppe 1",
    "B-Klasse Gruppe 2",
    "B-Klasse Gruppe 3",
    "C-Klasse Gruppe 1",
    "C-Klasse Gruppe 2",
    "C-Klasse Gruppe 3",
    "C-Klasse Gruppe 4",
    "C-Klasse Gruppe 5",
    "Mix B-Klasse",
    "Mix C-Klasse",
)

OPTIONAL_CLUB_FIELDS = (
    "venue",
    "street",
    "city",
    "phone",
    "fax",
    "contact",
    "mobile",
    "website",
    "contact_email",
    "email",
    "url",
)


def league_table(*teams: str) -> str:
    rows = [
        "<tr><td>Pl.</td><td>Tabelle</td><td>Sp</td><td>g</td><td>u</td>"
        "<td>v</td><td>Spiele</td><td>±</td><td>Pkt</td></tr>"
    ]
    rows.extend(
        f"<tr><td>{index}</td><td>{team}</td><td>0</td><td>0</td><td>0</td>"
        "<td>0</td><td>0:0</td><td>0</td><td>0</td></tr>"
        for index, team in enumerate(teams, 1)
    )
    return f"<table><tbody>{''.join(rows)}</tbody></table>"


def complete_league(name: str) -> dict[str, Any]:
    return {
        "url": f"https://example.test/{name}",
        "table": league_table(f"{name} Team", "Spielfrei"),
        "match_days": {
            f"{index}. Spieltag": "Mo. 24. 8.2026 20:00 Team A - Team B 0:0"
            for index in range(1, 19)
        },
    }


def league_candidate(season: str | None = "2026/27") -> dict[str, Any]:
    candidate: dict[str, Any] = {
        "leagues": {
            f"{name} 2026-2027": complete_league(name) for name in REGULAR_LEAGUES
        }
    }
    if season is not None:
        candidate["season"] = season
    return candidate


def player(player_id: Any, name: str, league: str) -> dict[str, Any]:
    return {"id": player_id, "name": name, "league": league}


def candidate_for(categories: tuple[str, ...], season: str | None = "2026/27") -> dict:
    candidate = {
        "rankings": {
            category: f"<table><tr><td>{category}</td></tr></table>"
            for category in categories
        },
        "players": [
            player(str(index), f"Player {index}", category)
            for index, category in enumerate(categories, 1)
        ],
    }
    if season is not None:
        candidate["season"] = season
    return candidate


def test_empty_candidate_retains_previous_season(prior_rankings: dict) -> None:
    result = validate_rankings(
        {"season": "2026/27", "rankings": {}, "players": []}, prior_rankings
    )

    assert result.decision is Decision.RETAIN
    assert result.effective_season == "2025/26"
    assert result.metrics == {category: 0 for category in REQUIRED_CATEGORIES}
    assert all(category in " ".join(result.reasons) for category in REQUIRED_CATEGORIES)


def test_partial_candidate_retains_previous_season(prior_rankings: dict) -> None:
    result = validate_rankings(candidate_for(REQUIRED_CATEGORIES[:3]), prior_rankings)

    assert result.decision is Decision.RETAIN
    assert result.effective_season == "2025/26"
    assert result.metrics["C-Klasse"] == 0
    assert "C-Klasse" in " ".join(result.reasons)


def test_complete_candidate_publishes_new_season(prior_rankings: dict) -> None:
    result = validate_rankings(candidate_for(REQUIRED_CATEGORIES), prior_rankings)

    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "2026/27"
    assert result.metrics == {category: 1 for category in REQUIRED_CATEGORIES}
    assert result.reasons == ()


def test_season_suffixed_category_labels_are_canonicalized(
    prior_rankings: dict,
) -> None:
    labels = tuple(f"{category} 2026-2027" for category in REQUIRED_CATEGORIES)

    result = validate_rankings(candidate_for(labels), prior_rankings)

    assert result.decision is Decision.PUBLISH
    assert result.metrics == {category: 1 for category in REQUIRED_CATEGORIES}


def test_player_missing_required_field_blocks_candidate(prior_rankings: dict) -> None:
    for missing_field in ("id", "name", "league"):
        candidate = candidate_for(REQUIRED_CATEGORIES)
        candidate["players"][0].pop(missing_field)

        result = validate_rankings(candidate, prior_rankings)

        assert result.decision is Decision.BLOCKED
        assert result.effective_season == "2025/26"
        assert result.metrics["invalid_players"] == 1
        assert "invalid" in " ".join(result.reasons).lower()


@pytest.mark.parametrize("invalid_id", [{}, [], 17, ""])
def test_non_string_or_blank_player_id_blocks_candidate(
    invalid_id: Any, prior_rankings: dict
) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["players"][0]["id"] = invalid_id

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert result.metrics["invalid_players"] == 1


def test_duplicate_player_id_in_same_category_blocks_candidate(
    prior_rankings: dict,
) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["players"].append(player("1", "Another Player", "Bezirksliga"))

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert result.effective_season == "2025/26"
    assert result.metrics["duplicate_players"] == 1
    assert "duplicate" in " ".join(result.reasons).lower()


def test_complete_candidate_without_explicit_season_is_blocked(
    prior_rankings: dict,
) -> None:
    result = validate_rankings(
        candidate_for(REQUIRED_CATEGORIES, season=None), prior_rankings
    )

    assert result.decision is Decision.BLOCKED
    assert result.effective_season == "2025/26"
    assert "season" in " ".join(result.reasons).lower()


def test_missing_previous_season_is_reported_as_unknown() -> None:
    result = validate_rankings(
        {"season": "2026/27", "rankings": {}, "players": []}, {}
    )

    assert result.decision is Decision.RETAIN
    assert result.effective_season == "unknown"


@pytest.mark.parametrize("malformed_table", [{"html": "<table></table>"}, "not html"])
def test_present_malformed_ranking_table_blocks_candidate(
    malformed_table: Any, prior_rankings: dict
) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"]["Bezirksliga"] = malformed_table

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert "malformed" in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    "unsafe_table",
    [
        "<table><tr><td onclick='run()'>Bezirksliga</td></tr></table>",
        "<table class='source'><tr><td>Bezirksliga</td></tr></table>",
        "<table><tr><td><script>run()</script>Bezirksliga</td></tr></table>",
        "<table><tr><td><svg onload='run()'></svg>Bezirksliga</td></tr></table>",
    ],
)
def test_unsafe_ranking_table_blocks_candidate(
    unsafe_table: str,
    prior_rankings: dict,
) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"] = {
        category: "<table><tr><td>Safe</td></tr></table>"
        for category in REQUIRED_CATEGORIES
    }
    candidate["rankings"]["Bezirksliga"] = unsafe_table

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert "unsafe" in " ".join(result.reasons).lower()
    assert "run()" not in " ".join(result.reasons)


@pytest.mark.parametrize(
    "malformed_table",
    [
        "</table><table>",
        "<table>missing close",
        "<tableau>wrong tag</table>",
        "<table>first</table><table>second</table>",
    ],
)
def test_ranking_table_requires_one_ordered_outer_table(
    malformed_table: str, prior_rankings: dict
) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"]["Bezirksliga"] = malformed_table

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert result.metrics["malformed_ranking_tables"] == 1


def test_empty_ranking_table_retains_previous_season(prior_rankings: dict) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"]["Bezirksliga"] = "   "

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.RETAIN
    assert result.effective_season == "2025/26"


def test_ranking_table_tags_are_case_insensitive(prior_rankings: dict) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"] = {
        category: f"<TABLE><TR><TD>{category}</TD></TR></TABLE>"
        for category in REQUIRED_CATEGORIES
    }

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.PUBLISH


def test_unknown_nonblank_ranking_key_blocks_candidate(prior_rankings: dict) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"]["Oberliga"] = "<table>Unexpected</table>"

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert result.metrics["invalid_ranking_categories"] == 1


@pytest.mark.parametrize("invalid_key", ["", "   ", None, 17])
def test_every_unparseable_ranking_key_blocks_candidate(
    invalid_key: Any, prior_rankings: dict
) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"][invalid_key] = "<table>Unexpected</table>"

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert result.metrics["invalid_ranking_categories"] == 1


def test_duplicate_canonical_ranking_keys_block_candidate(
    prior_rankings: dict,
) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"]["A-Klasse 2026-2027"] = "<table>Duplicate</table>"

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert result.metrics["duplicate_ranking_categories"] == 1


def test_arbitrary_category_suffix_blocks_candidate(prior_rankings: dict) -> None:
    labels = tuple(f"{category} juniors" for category in REQUIRED_CATEGORIES)

    result = validate_rankings(candidate_for(labels), prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert "category" in " ".join(result.reasons).lower()


def test_category_season_suffix_must_match_candidate_season(
    prior_rankings: dict,
) -> None:
    labels = tuple(f"{category} 2025-2026" for category in REQUIRED_CATEGORIES)

    result = validate_rankings(candidate_for(labels), prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert "season" in " ".join(result.reasons).lower()


def test_partial_consistent_suffixes_without_season_retain_previous(
    prior_rankings: dict,
) -> None:
    labels = tuple(
        f"{category} 2026-2027" for category in REQUIRED_CATEGORIES[:3]
    )

    result = validate_rankings(candidate_for(labels, season=None), prior_rankings)

    assert result.decision is Decision.RETAIN
    assert result.effective_season == "2025/26"
    assert "season_mismatches" not in result.metrics


def test_complete_consistent_suffixes_without_season_block_as_missing(
    prior_rankings: dict,
) -> None:
    labels = tuple(f"{category} 2026-2027" for category in REQUIRED_CATEGORIES)

    result = validate_rankings(candidate_for(labels, season=None), prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert "missing" in " ".join(result.reasons).lower()


def test_partial_conflicting_suffix_seasons_block_candidate(
    prior_rankings: dict,
) -> None:
    labels = (
        "Bezirksliga 2026-2027",
        "A-Klasse 2026-2027",
        "B-Klasse 2027-2028",
    )

    result = validate_rankings(candidate_for(labels, season=None), prior_rankings)

    assert result.decision is Decision.BLOCKED
    assert result.metrics["conflicting_suffix_seasons"] == 2
    assert "conflict" in " ".join(result.reasons).lower()


@pytest.mark.parametrize("invalid_season", ["not-a-season", "2026/29"])
def test_invalid_or_nonconsecutive_candidate_season_blocks_candidate(
    invalid_season: str, prior_rankings: dict
) -> None:
    result = validate_rankings(
        candidate_for(REQUIRED_CATEGORIES, season=invalid_season), prior_rankings
    )

    assert result.decision is Decision.BLOCKED
    assert "season" in " ".join(result.reasons).lower()


@pytest.mark.parametrize("season", ["2026/2027", "2026-2027"])
def test_candidate_season_is_normalized_for_publication(
    season: str, prior_rankings: dict
) -> None:
    result = validate_rankings(
        candidate_for(REQUIRED_CATEGORIES, season=season), prior_rankings
    )

    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "2026/27"


def test_validation_result_defensively_copies_and_freezes_collections() -> None:
    reasons = ["original"]
    metrics = {"players": 1}
    result = ValidationResult(
        domain="rankings",
        decision=Decision.RETAIN,
        effective_season="2025/26",
        reasons=reasons,
        metrics=metrics,
    )

    reasons.append("changed")
    metrics["players"] = 2

    assert result.reasons == ("original",)
    assert result.metrics == {"players": 1}
    with pytest.raises(AttributeError):
        result.reasons.append("forbidden")
    with pytest.raises(TypeError):
        result.metrics["players"] = 3


def test_validation_result_serializes_to_detached_json_safe_dict() -> None:
    result = ValidationResult(
        domain="rankings",
        decision=Decision.BLOCKED,
        effective_season="2025/26",
        reasons=["invalid candidate"],
        metrics={"invalid_players": 1},
    )

    serialized = result.to_dict()

    assert json.loads(json.dumps(serialized)) == {
        "domain": "rankings",
        "decision": "blocked",
        "effective_season": "2025/26",
        "reasons": ["invalid candidate"],
        "metrics": {"invalid_players": 1},
    }
    serialized["reasons"].append("changed")
    serialized["metrics"]["invalid_players"] = 2
    assert result.reasons == ("invalid candidate",)
    assert result.metrics == {"invalid_players": 1}


def test_same_player_id_in_different_categories_is_allowed(
    prior_rankings: dict,
) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    for candidate_player in candidate["players"]:
        candidate_player["id"] = "shared-id"

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.PUBLISH


def test_validation_does_not_mutate_inputs(prior_rankings: dict) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate_before = deepcopy(candidate)
    previous_before = deepcopy(prior_rankings)

    validate_rankings(candidate, prior_rankings)

    assert candidate == candidate_before
    assert prior_rankings == previous_before


def test_missing_category_reasons_follow_required_category_order(
    prior_rankings: dict,
) -> None:
    result = validate_rankings(
        {"season": "2026/27", "rankings": {}, "players": []}, prior_rankings
    )

    assert result.reasons == tuple(
        f"Missing ready category: {category}" for category in REQUIRED_CATEGORIES
    )


def test_one_current_regular_league_blocks_expected_count() -> None:
    candidate = {
        "season": "2026/27",
        "leagues": {"Bezirksliga 2026-2027": complete_league("Bezirksliga")},
    }

    result = validation.validate_leagues(candidate, {"season": "2025/26"})

    assert result.decision is Decision.BLOCKED
    assert "13" in " ".join(result.reasons)


def test_complete_current_leagues_publish_with_zero_standings() -> None:
    result = validation.validate_leagues(
        league_candidate(), {"season": "2025/26"}
    )

    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "2026/27"
    assert result.metrics["regular_leagues"] == 13
    assert result.reasons == ()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda table: table.replace("<table>", "<table class='source'>", 1),
        lambda table: table.replace("<tr>", "<tr onclick='run()'>", 1),
        lambda table: table.replace("Bezirksliga Team", "<script>run()</script>Bezirksliga Team", 1),
    ],
)
def test_unsafe_current_league_table_blocks_without_echoing_payload(mutation) -> None:
    candidate = league_candidate()
    league = candidate["leagues"]["Bezirksliga 2026-2027"]
    league["table"] = mutation(league["table"])

    result = validation.validate_leagues(candidate, {"season": "2025/26"})

    assert result.decision is Decision.BLOCKED
    assert "unsafe" in " ".join(result.reasons).lower()
    assert "run()" not in " ".join(result.reasons)


def test_league_season_is_inferred_from_newest_regular_key_suffix() -> None:
    candidate = league_candidate(season=None)
    candidate["leagues"]["Bezirksliga 2025-2026"] = {"not": "validated"}

    result = validation.validate_leagues(candidate, {"season": "2025/26"})

    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "2026/27"


def test_explicit_league_season_must_equal_newest_inferred_season() -> None:
    candidate = league_candidate(season="2025/26")
    candidate["leagues"].update(
        {
            f"{name} 2025-2026": complete_league(f"Historical {name}")
            for name in REGULAR_LEAGUES
        }
    )

    result = validation.validate_leagues(candidate, {"season": "2025/26"})

    assert result.decision is Decision.BLOCKED
    assert "newest" in " ".join(result.reasons).lower()


def test_fourteen_valid_current_leagues_publish() -> None:
    candidate = league_candidate()
    candidate["leagues"]["Additional Division 2026-2027"] = complete_league(
        "Additional Division"
    )

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.PUBLISH
    assert result.metrics["regular_leagues"] == 14


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("table", ""),
        ("table", "<table><tr><td>missing close"),
        ("match_days", {"1. Spieltag": ""}),
        ("match_days", {f"{index}. Spieltag": "" for index in range(17)}),
        ("match_days", {"": "", **{str(index): "" for index in range(17)}}),
    ],
)
def test_incomplete_current_league_blocks(field: str, value: Any) -> None:
    candidate = league_candidate()
    candidate["leagues"]["Bezirksliga 2026-2027"][field] = value

    result = validation.validate_leagues(candidate, {"season": "2025/26"})

    assert result.decision is Decision.BLOCKED


def test_duplicate_nonblank_team_within_league_blocks() -> None:
    candidate = league_candidate()
    candidate["leagues"]["Bezirksliga 2026-2027"]["table"] = league_table(
        "DC Ölbronn", " dc   ölbronn "
    )

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.BLOCKED
    assert "duplicate" in " ".join(result.reasons).lower()


def test_blank_team_cell_blocks_but_repeated_spielfrei_is_allowed() -> None:
    candidate = league_candidate()
    candidate["leagues"]["Bezirksliga 2026-2027"]["table"] = league_table(
        "Team Eins", "Spielfrei", "Spielfrei"
    )
    assert validation.validate_leagues(candidate, {}).decision is Decision.PUBLISH

    candidate["leagues"]["Bezirksliga 2026-2027"]["table"] = league_table(
        "Team Eins", " "
    )
    assert validation.validate_leagues(candidate, {}).decision is Decision.BLOCKED


def test_table_requires_at_least_one_non_spielfrei_team() -> None:
    candidate = league_candidate()
    candidate["leagues"]["Bezirksliga 2026-2027"]["table"] = league_table(
        "Spielfrei", "Spielfrei"
    )

    assert validation.validate_leagues(candidate, {}).decision is Decision.BLOCKED


def test_league_table_ignores_nonstandard_header_row() -> None:
    candidate = league_candidate()
    candidate["leagues"]["Bezirksliga 2026-2027"]["table"] = (
        "<table><tbody>"
        "<tr><th>A</th><th>Beliebige Überschrift</th><th>C</th><th>D</th>"
        "<th>E</th><th>F</th><th>G</th><th>H</th><th>I</th></tr>"
        "<tr><td>1.</td><td>DC Schömberg</td><td>0</td><td>0</td><td>0</td>"
        "<td>0</td><td>0:0</td><td>0</td><td>0</td></tr>"
        "<tr><td>2.</td><td>Spielfrei</td><td>0</td><td>0</td><td>0</td>"
        "<td>0</td><td>0:0</td><td>0</td><td>0</td></tr>"
        "</tbody></table>"
    )

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.PUBLISH


def test_league_table_requires_at_least_nine_columns() -> None:
    candidate = league_candidate()
    candidate["leagues"]["Bezirksliga 2026-2027"]["table"] = (
        "<table><tr><td>Pl.</td><td>Tabelle</td></tr>"
        "<tr><td>1.</td><td>DC Schömberg</td></tr></table>"
    )

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.BLOCKED
    assert "columns" in " ".join(result.reasons).lower()


def test_league_table_rejects_data_row_with_inconsistent_columns() -> None:
    candidate = league_candidate()
    valid_table = league_table("DC Schömberg", "Spielfrei")
    candidate["leagues"]["Bezirksliga 2026-2027"]["table"] = valid_table.replace(
        "<td>0</td><td>0</td></tr>", "<td>0</td></tr>", 1
    )

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.BLOCKED
    assert "columns" in " ".join(result.reasons).lower()


def test_league_table_accepts_withdrawn_team_row_with_colspan() -> None:
    candidate = league_candidate()
    candidate["leagues"]["C-Klasse Gruppe 1 2026-2027"]["table"] = (
        "<table><tbody>"
        "<tr><td>Pl.</td><td>Tabelle</td><td>Sp</td><td>S</td><td>U</td>"
        "<td>N</td><td>Spiele</td><td>±</td><td>Pkt</td></tr>"
        "<tr><td>1.</td><td>DC Höfle</td><td>0</td><td>0</td><td>0</td>"
        "<td>0</td><td>0:0</td><td>±0</td><td>0</td></tr>"
        "<tr><td>10.</td><td>DC Oststadt 2</td>"
        "<td colspan='7'>zurückgezogen</td></tr>"
        "</tbody></table>"
    )

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.PUBLISH


def test_matchday_keys_must_cover_exact_sequence_one_through_eighteen() -> None:
    candidate = league_candidate()
    candidate["leagues"]["Bezirksliga 2026-2027"]["match_days"] = {
        f"{index}. Spieltag": "---" for index in range(2, 20)
    }

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.BLOCKED
    assert "sequence" in " ".join(result.reasons).lower()


def test_matchday_keys_allow_whitespace_and_placeholder_value() -> None:
    candidate = league_candidate()
    match_days = candidate["leagues"]["Bezirksliga 2026-2027"]["match_days"]
    match_days["  1.   Spieltag  "] = match_days.pop("1. Spieltag")
    match_days["  1.   Spieltag  "] = "---"

    assert validation.validate_leagues(candidate, {}).decision is Decision.PUBLISH


@pytest.mark.parametrize("value", [17, ["Mo. 24. 8.2026"], "no date here"])
def test_matchday_values_require_strings_with_supported_dates(value: Any) -> None:
    candidate = league_candidate()
    candidate["leagues"]["Bezirksliga 2026-2027"]["match_days"][
        "1. Spieltag"
    ] = value

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.BLOCKED
    assert "matchday" in " ".join(result.reasons).lower()


def test_historical_and_ligapokal_leagues_do_not_affect_current_validation() -> None:
    candidate = league_candidate()
    candidate["leagues"].update(
        {
            "Broken League 2025-2026": {"malformed": True},
            "Ligapokal 2026-2027": {"malformed": True},
        }
    )

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.PUBLISH
    assert result.metrics["regular_leagues"] == 13


def test_normalized_duplicate_current_league_keys_block() -> None:
    candidate = league_candidate()
    candidate["leagues"].pop("Mix C-Klasse 2026-2027")
    candidate["leagues"]["  bezirksliga   2026-2027"] = complete_league(
        "Duplicate Bezirksliga"
    )

    result = validation.validate_leagues(candidate, {})

    assert result.decision is Decision.BLOCKED
    assert "duplicate" in " ".join(result.reasons).lower()


@pytest.mark.parametrize("season", ["2026/29", "2025/26"])
def test_invalid_or_mismatching_explicit_league_season_blocks(season: str) -> None:
    candidate = league_candidate(season=season)

    result = validation.validate_leagues(candidate, {"season": "2025/26"})

    assert result.decision is Decision.BLOCKED
    assert "season" in " ".join(result.reasons).lower()


def clubs(count: int) -> dict[str, Any]:
    return {
        "season": "2026/27",
        "clubs": [
            {
                "name": f"Dartclub {index}",
                "number": f"{index:03d}",
                "phone": "",
                "contact_email": "",
            }
            for index in range(1, count + 1)
        ],
    }


def test_empty_clubs_cannot_replace_nonempty_previous() -> None:
    result = validation.validate_clubs({"clubs": []}, clubs(5))

    assert result.decision is Decision.BLOCKED


def test_empty_clubs_block_without_previous_baseline() -> None:
    result = validation.validate_clubs({"clubs": []}, {})

    assert result.decision is Decision.BLOCKED


@pytest.mark.parametrize("container", [{}, "clubs", None])
def test_candidate_clubs_container_must_be_a_list(container: Any) -> None:
    result = validation.validate_clubs({"clubs": container}, clubs(2))

    assert result.decision is Decision.BLOCKED


@pytest.mark.parametrize("container", [{}, "clubs", None])
def test_previous_clubs_container_must_be_a_list(container: Any) -> None:
    result = validation.validate_clubs(clubs(2), {"clubs": container})

    assert result.decision is Decision.BLOCKED
    assert "previous" in " ".join(result.reasons).lower()


def test_club_entries_must_be_dicts_in_candidate_and_previous() -> None:
    candidate = clubs(2)
    candidate["clubs"][0] = "not a club"
    assert validation.validate_clubs(candidate, clubs(2)).decision is Decision.BLOCKED

    previous = clubs(2)
    previous["clubs"][0] = "not a club"
    assert validation.validate_clubs(clubs(2), previous).decision is Decision.BLOCKED


@pytest.mark.parametrize(
    ("field", "value"),
    [("name", None), ("name", " "), ("number", None), ("number", " ")],
)
def test_club_requires_nonblank_name_and_number(field: str, value: Any) -> None:
    candidate = clubs(2)
    if value is None:
        candidate["clubs"][0].pop(field)
    else:
        candidate["clubs"][0][field] = value

    assert validation.validate_clubs(candidate, clubs(2)).decision is Decision.BLOCKED


def test_duplicate_club_number_blocks() -> None:
    candidate = clubs(2)
    candidate["clubs"][1]["number"] = " 001 "

    result = validation.validate_clubs(candidate, clubs(2))

    assert result.decision is Decision.BLOCKED
    assert "duplicate" in " ".join(result.reasons).lower()


def test_club_count_below_eighty_percent_blocks() -> None:
    result = validation.validate_clubs(clubs(7), clubs(10))

    assert result.decision is Decision.BLOCKED
    assert "80" in " ".join(result.reasons)


def test_exactly_eighty_percent_clubs_publish_with_metric() -> None:
    result = validation.validate_clubs(clubs(8), clubs(10))

    assert result.decision is Decision.PUBLISH
    assert result.metrics == {"clubs": 8}


def test_valid_clubs_preserve_blank_optional_contact_fields() -> None:
    candidate = clubs(2)
    before = deepcopy(candidate)

    result = validation.validate_clubs(candidate, clubs(2))

    assert result.decision is Decision.PUBLISH
    assert candidate == before


@pytest.mark.parametrize("field", OPTIONAL_CLUB_FIELDS)
def test_present_optional_club_fields_must_be_strings(field: str) -> None:
    candidate = clubs(2)
    candidate["clubs"][0][field] = 17

    result = validation.validate_clubs(candidate, clubs(2))

    assert result.decision is Decision.BLOCKED
    assert field in " ".join(result.reasons)


def test_archive_candidate_must_retain_every_previous_season() -> None:
    result = validation.validate_archives({"2025/26"}, {"2024/25", "2025/26"})

    assert result.decision is Decision.BLOCKED
    assert "2024/25" in " ".join(result.reasons)


def test_empty_archive_candidate_cannot_replace_previous() -> None:
    result = validation.validate_archives(set(), {"2025/26"})

    assert result.decision is Decision.BLOCKED


@pytest.mark.parametrize("candidate", [set(), {"2026/27"}])
def test_archive_requires_nonempty_previous_baseline(candidate: set[str]) -> None:
    result = validation.validate_archives(candidate, set())

    assert result.decision is Decision.BLOCKED
    assert "previous" in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    ("candidate", "previous"),
    [(["2025/26"], {"2025/26"}), ({"2025/26"}, ["2025/26"]), ({}, {})],
)
def test_archive_containers_must_be_actual_sets(
    candidate: Any, previous: Any
) -> None:
    try:
        result = validation.validate_archives(candidate, previous)
    except Exception as error:
        pytest.fail(f"validator raised for malformed containers: {error}")

    assert result.decision is Decision.BLOCKED
    assert "set" in " ".join(result.reasons).lower()


@pytest.mark.parametrize("invalid", ["2024/24", "season 2024/25", 2025])
def test_archive_rejects_invalid_season_identifiers(invalid: Any) -> None:
    result = validation.validate_archives({"2024/25", invalid}, {"2024/25"})

    assert result.decision is Decision.BLOCKED
    assert "invalid" in " ".join(result.reasons).lower()


def test_archive_rejects_duplicate_normalized_seasons() -> None:
    result = validation.validate_archives(
        {"2024/25", "2024-2025"}, {"2024/25"}
    )

    assert result.decision is Decision.BLOCKED
    assert "duplicate" in " ".join(result.reasons).lower()


def test_archive_compares_canonical_season_labels() -> None:
    result = validation.validate_archives(
        {"2024-2025", "2025/26"}, {"2024/25"}
    )

    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "2025/26"


def test_archive_normalizes_short_and_multi_year_historical_labels() -> None:
    result = validation.validate_archives(
        {"20/22", "24/25", "2025/2026"},
        {"2020/2022", "2024/25"},
    )

    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "2025/26"


def archive_record(season: str, *, league: str = "A-Klasse", rank: int = 1) -> dict[str, Any]:
    return {"season": season, "league": league, "rank": rank, "points": 10, "name": "Player"}


def enriched_archive_record(
    season: str = "24/25", *, league: str = "A-Klasse"
) -> dict[str, Any]:
    return {
        "season": season,
        "league": league,
        "rank": 1,
        "name": "Player",
        "points": 12,
        "v_nr": "018",
        "rounds": {"R1": 5, "R2": "x", "R3": 0, "R4": 7},
        "appearances": 3,
        "points_per_appearance": 4.0,
    }


def segmented_archive_record(
    *,
    player_id: str = "4711",
    season: str = "2024/2025",
    segments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    source_segments = segments or [
        {
            "league": "A-Klasse",
            "rank": 1,
            "name": "Player",
            "points": 12,
            "v_nr": "018",
            "rounds": {"R1": 5, "R2": "Vw", "R3": 0, "R4": 7},
            "appearances": 3,
            "points_per_appearance": 4.0,
        }
    ]
    merged = merge_archive_entries(
        [
            {"id": player_id, "season": season, **deepcopy(segment)}
            for segment in source_segments
        ]
    )
    return merged[player_id][0]


def legacy_preview_record() -> dict[str, Any]:
    record = enriched_archive_record()
    for field in ("v_nr", "rounds", "appearances", "points_per_appearance"):
        record.pop(field)
    return record


def archive_table(
    season: str,
    *,
    league: str = "A-Klasse",
    marker: int = 1,
    row_count: int = 1,
) -> dict[str, Any]:
    return {
        "season": season,
        "league": league,
        "rows": [
            {"rank": marker + offset, "name": f"Player {marker + offset}"}
            for offset in range(row_count)
        ],
    }


def test_archive_payload_accepts_current_title_for_legacy_championship() -> None:
    previous_data = {"4711": [archive_record("25/26")]}
    candidate_data = deepcopy(previous_data)
    previous_tables = [
        {
            "season": "2025/2026",
            "league": "MM_C-Klasse 2025-26",
            "rows": [{"rank": 1}, {"rank": 2}],
        }
    ]
    candidate_tables = [
        {
            "season": "2025/2026",
            "league": "Bwedl e.V. 2025/2026 C-Klasse Meisterschaft",
            "rows": [{"rank": 1}, {"rank": 2}],
        }
    ]

    result = validation.validate_archive_payloads(
        candidate_data, previous_data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_reconciles_exact_rows_after_same_season_title_correction() -> None:
    data = {"4711": [archive_record("20/22")]}
    rows = [
        ["Runde/Info", "Pl.", "Tabelle", "Sp.", "Punkte"],
        ["", "1", "DC Beispiel", "8", "16"],
        ["", "2", "SV Muster", "8", "12"],
    ]
    previous_tables = [
        {
            "season": "2020/2022",
            "league": "C-Klassen-Meisterschaft, Platz 1-4_2020-2022",
            "rows": deepcopy(rows),
        }
    ]
    candidate_tables = [
        {
            "season": "20/22",
            "league": "BWEDL e.V. Saison 2020-2022 - Mix-C-Klasse",
            "rows": deepcopy(rows),
        }
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH


@pytest.mark.parametrize(
    ("previous_league", "candidate_league"),
    [
        ("A-Klasse", "B-Klasse"),
        ("Unrelated Alpha", "Unrelated Beta"),
    ],
)
def test_archive_payload_does_not_reconcile_unrelated_exact_row_titles(
    previous_league: str, candidate_league: str
) -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_table = {
        "season": "2025/2026",
        "league": previous_league,
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": candidate_league,
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    ("previous_league", "candidate_league"),
    [
        ("Historische Bezirksliga Tabelle", "Aktuelle Bezirksliga Tabelle"),
        ("Liga-Pokal Wertung", "Ligapokal Abschlusstabelle"),
    ],
)
def test_archive_payload_reconciles_exact_rows_with_same_named_family(
    previous_league: str, candidate_league: str
) -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_table = {
        "season": "2025/2026",
        "league": previous_league,
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": candidate_league,
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_reconciles_legacy_unknown_to_meaningful_exact_rows() -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_table = {
        "season": "2025/2026",
        "league": "Unbekannt",
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": "LIGAPOKAL 2025/2026",
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_does_not_reconcile_unknown_to_structural_title() -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_table = {
        "season": "2025/2026",
        "league": "Unbekannt",
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": "Pokal Final 1",
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


def test_archive_payload_does_not_reconcile_meaningful_title_to_unknown() -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_table = {
        "season": "2025/2026",
        "league": "LIGAPOKAL 2025/2026",
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": "Unbekannt",
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


def test_archive_payload_does_not_treat_generic_title_as_unknown_sentinel() -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_table = {
        "season": "2025/2026",
        "league": "Unrelated Alpha",
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": "LIGAPOKAL 2025/2026",
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


def test_archive_payload_does_not_reconcile_unknown_across_seasons() -> None:
    data = {"4711": [archive_record("24/25")]}
    rows = archive_table("24/25", row_count=3)["rows"]
    previous_table = {
        "season": "2024/2025",
        "league": "Unbekannt",
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": "LIGAPOKAL 2025/2026",
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


def test_archive_payload_does_not_reconcile_unknown_with_changed_rows() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_table = archive_table(
        "2025/2026", league="Unbekannt", marker=1, row_count=3
    )
    candidate_table = archive_table(
        "25/26", league="LIGAPOKAL 2025/2026", marker=20, row_count=3
    )

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


def test_archive_payload_consumes_unknown_exact_row_match_only_once() -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_tables = [
        {
            "season": "2025/2026",
            "league": "Unbekannt",
            "rows": deepcopy(rows),
        },
        {
            "season": "25/26",
            "league": "Unbekannt",
            "rows": deepcopy(rows),
        },
    ]
    candidate_table = {
        "season": "2025-2026",
        "league": "LIGAPOKAL 2025/2026",
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


@pytest.mark.parametrize("reverse_previous", [False, True])
@pytest.mark.parametrize("reverse_candidate", [False, True])
def test_archive_payload_exact_row_matching_is_order_invariant(
    reverse_previous: bool, reverse_candidate: bool
) -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_tables = [
        {
            "season": "2025/2026",
            "league": "Unbekannt",
            "rows": deepcopy(rows),
        },
        {
            "season": "25/26",
            "league": "Ligapokal",
            "rows": deepcopy(rows),
        },
    ]
    candidate_tables = [
        {
            "season": "2025-2026",
            "league": "Ligapokal",
            "rows": deepcopy(rows),
        },
        {
            "season": "2025/2026",
            "league": "A-Klasse",
            "rows": deepcopy(rows),
        },
    ]
    if reverse_previous:
        previous_tables.reverse()
    if reverse_candidate:
        candidate_tables.reverse()

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_blocks_changed_rows_under_different_title() -> None:
    data = {"4711": [archive_record("20/22")]}
    previous_tables = [
        archive_table(
            "2020/2022",
            league="C-Klassen-Meisterschaft, Platz 1-4_2020-2022",
            marker=1,
            row_count=5,
        )
    ]
    candidate_tables = [
        archive_table(
            "20/22",
            league="BWEDL e.V. Saison 2020-2022 - Mix-C-Klasse",
            marker=20,
            row_count=5,
        )
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "table" in " ".join(result.reasons).lower()


def test_archive_payload_does_not_reconcile_identical_rows_across_seasons() -> None:
    data = {"4711": [archive_record("20/22")]}
    previous_table = archive_table(
        "2020/2022",
        league="C-Klassen-Meisterschaft, Platz 1-4_2020-2022",
        marker=1,
        row_count=5,
    )
    candidate_table = {
        **deepcopy(previous_table),
        "season": "2024/2025",
        "league": "BWEDL e.V. Saison 2024-2025 - Mix-C-Klasse",
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table" in " ".join(result.reasons).lower()


def test_archive_payload_consumes_exact_row_match_only_once() -> None:
    data = {"4711": [archive_record("20/22")]}
    rows = archive_table("20/22", marker=1, row_count=5)["rows"]
    previous_tables = [
        {
            "season": "2020/2022",
            "league": "Historical C-Klassen label one",
            "rows": deepcopy(rows),
        },
        {
            "season": "20/22",
            "league": "Historical Mix C-Klasse label two",
            "rows": deepcopy(rows),
        },
    ]
    candidate_tables = [
        {
            "season": "2020-2022",
            "league": "Corrected C-Klasse current label",
            "rows": deepcopy(rows),
        }
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


def test_archive_payload_keeps_c_class_groups_distinct() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_tables = [archive_table("25/26", league="C-Klasse Gruppe 1")]
    candidate_tables = [archive_table("25/26", league="C-Klasse Gruppe 2")]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "table" in " ".join(result.reasons).lower()


def test_archive_payload_keeps_cup_rounds_distinct() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_tables = [archive_table("25/26", league="Pokal Runde 16-32")]
    candidate_tables = [archive_table("25/26", league="Pokal Runde 32-64")]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "table" in " ".join(result.reasons).lower()


def test_archive_payload_keeps_cup_final_variants_distinct() -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_table = {
        "season": "2025/2026",
        "league": "Pokal Final 1",
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": "Pokal Final 2",
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    ("previous_league", "candidate_league"),
    [
        ("Pokal Finalrunde 1", "Pokal Finalrunde 2"),
        ("Pokal Gruppenphase A", "Pokal Gruppenphase B"),
        ("Pokal Gruppen-Phase A", "Pokal Gruppen-Phase B"),
        ("Pokal Gruppen Phase A", "Pokal Gruppen Phase B"),
        ("Pokal Gruppenrunde A", "Pokal Gruppenrunde B"),
        ("Pokal Vorrunde", "Pokal Endrunde"),
        ("Pokal Final-Runde 1", "Pokal Final-Runde 2"),
        ("Pokal Vor Runde", "Pokal End Runde"),
        ("Pokal Halb-Finale 1", "Pokal Halb-Finale 2"),
    ],
)
def test_archive_payload_keeps_compound_cup_stages_distinct(
    previous_league: str, candidate_league: str
) -> None:
    data = {"4711": [archive_record("25/26")]}
    rows = archive_table("25/26", row_count=3)["rows"]
    previous_table = {
        "season": "2025/2026",
        "league": previous_league,
        "rows": deepcopy(rows),
    }
    candidate_table = {
        "season": "25/26",
        "league": candidate_league,
        "rows": deepcopy(rows),
    }

    result = validation.validate_archive_payloads(
        data, data, [candidate_table], [previous_table]
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


def test_archive_payload_ignores_presentation_date_in_title() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_tables = [archive_table("25/26", league="A-Klasse")]
    candidate_tables = [
        archive_table("2025/2026", league="Bwedl e.V. A-Klasse am 13.06.2026")
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_ignores_underscore_separators_around_title_metadata() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_tables = [archive_table("25/26", league="A-Klasse")]
    candidate_tables = [
        archive_table(
            "2025/2026", league="Bwedl_e.V._A-Klasse_am_13.06.2026"
        )
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_blocks_same_identity_table_count_loss() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_tables = [
        archive_table("25/26", marker=1),
        archive_table("2025/2026", marker=10),
    ]
    candidate_tables = [archive_table("25/26", marker=20)]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "table count loss" in " ".join(result.reasons).lower()


def test_archive_payload_blocks_paired_same_identity_row_count_loss() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_tables = [
        archive_table("25/26", marker=1, row_count=3),
        archive_table("2025/2026", marker=10, row_count=2),
    ]
    candidate_tables = [
        archive_table("25/26", marker=20, row_count=3),
        archive_table("2025/2026", marker=30, row_count=1),
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "row count loss" in " ".join(result.reasons).lower()


def test_archive_payload_accepts_reordered_same_identity_tables_without_loss() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_tables = [
        archive_table("25/26", marker=1, row_count=3),
        archive_table("2025/2026", marker=10, row_count=1),
    ]
    candidate_tables = [
        archive_table("2025/2026", marker=20, row_count=1),
        archive_table("25/26", marker=30, row_count=4),
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_blocks_row_loss_after_title_normalization() -> None:
    data = {"4711": [archive_record("25/26")]}
    previous_tables = [
        {
            "season": "2025/2026",
            "league": "MM_C-Klasse 2025-26",
            "rows": [{"rank": 1}, {"rank": 2}],
        }
    ]
    candidate_tables = [
        {
            "season": "2025/2026",
            "league": "Bwedl e.V. 2025/2026 C-Klasse Meisterschaft",
            "rows": [{"rank": 1}],
        }
    ]

    result = validation.validate_archive_payloads(
        data, data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert "row count loss" in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    ("candidate_data", "candidate_tables", "reason"),
    [
        ({"4711": [archive_record("24/25")]}, [archive_table("24/25")], "record"),
        ({"4711": [archive_record("24/25"), archive_record("25/26")]}, [archive_table("24/25")], "table"),
        ({}, [archive_table("24/25"), archive_table("25/26")], "player"),
        ({"4711": [archive_record("24/25"), archive_record("24/25"), archive_record("25/26")]}, [archive_table("24/25"), archive_table("25/26")], "duplicate"),
        ({"4711": [archive_record("24/25"), archive_record("25/26")]}, [archive_table("24/25"), archive_table("24/25"), archive_table("25/26")], "duplicate"),
        ({"4711": []}, [archive_table("24/25"), archive_table("25/26")], "nonempty"),
    ],
)
def test_archive_payload_completeness_blocks_loss_or_malformed_data(
    candidate_data: Any, candidate_tables: Any, reason: str
) -> None:
    previous_data = {"4711": [archive_record("24/25"), archive_record("25/26")]}
    previous_tables = [archive_table("24/25"), archive_table("25/26")]

    result = validation.validate_archive_payloads(
        candidate_data, previous_data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.BLOCKED
    assert reason in " ".join(result.reasons).lower()


def test_archive_payload_equal_or_superset_publishes() -> None:
    previous_data = {"4711": [archive_record("20/22"), archive_record("24/25")]}
    previous_tables = [archive_table("2020/2022"), archive_table("24/25")]
    candidate_data = deepcopy(previous_data)
    candidate_data["811"] = [archive_record("25/26", league="B-Klasse")]
    candidate_tables = deepcopy(previous_tables) + [archive_table("25/26", league="B-Klasse")]

    result = validation.validate_archive_payloads(
        candidate_data, previous_data, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "2025/26"


def test_archive_payload_accepts_consistent_preview_evidence_without_mutation() -> None:
    data = {"4711": [enriched_archive_record()]}
    tables = [archive_table("24/25")]
    original_data = deepcopy(data)
    original_tables = deepcopy(tables)

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.PUBLISH
    assert result.reasons == ()
    assert data == original_data
    assert tables == original_tables


def test_archive_payload_keeps_totals_only_legacy_records_valid() -> None:
    data = {"4711": [archive_record("24/25")]}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.PUBLISH


def test_archive_validator_defers_cross_season_name_conflicts_to_player_join() -> None:
    older = {**archive_record("24/25"), "name": "Published Name"}
    newer = {**archive_record("25/26"), "name": "Changed Published Name"}
    data = {"4711": [older, newer]}
    tables = [archive_table("24/25"), archive_table("25/26")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.PUBLISH


@pytest.mark.parametrize(
    ("player_key", "mutation", "reason"),
    [
        ("47A1", lambda record: None, "player id"),
        ("٤٧١١", lambda record: None, "player id"),
        ("4711", lambda record: record.update({"id": "9999"}), "player id"),
        ("4711", lambda record: record.update({"id": "٤٧١١"}), "player id"),
        ("4711", lambda record: record.update({"season": "٢٠٢٤/٢٥"}), "season"),
        ("4711", lambda record: record.update({"league": "  "}), "league"),
        ("4711", lambda record: record.update({"name": "  "}), "name"),
        ("4711", lambda record: record.update({"rank": True}), "rank"),
        ("4711", lambda record: record.update({"rank": 1.0}), "rank"),
        ("4711", lambda record: record.update({"rank": 2**53 + 1}), "safe integer"),
        ("4711", lambda record: record.update({"points": True}), "points"),
        ("4711", lambda record: record.update({"points": 12.0}), "points"),
        ("4711", lambda record: record.update({"points": 2**53}), "safe integer"),
        ("4711", lambda record: record.update({"points": 10**400}), "safe integer"),
        ("4711", lambda record: record.update({"v_nr": ""}), "club number"),
        ("4711", lambda record: record.update({"v_nr": "٠١٨"}), "club number"),
    ],
)
def test_archive_candidate_totals_only_records_require_safe_core_schema(
    player_key: str, mutation: Any, reason: str
) -> None:
    record = legacy_preview_record()
    mutation(record)
    data = {player_key: [record]}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert reason in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (
            lambda record: record.update(
                {
                    "points": 2**53,
                    "rounds": {"R1": 2**53},
                    "appearances": 1,
                    "points_per_appearance": float(2**53),
                }
            ),
            "safe integer",
        ),
        (
            lambda record: record.update(
                {
                    "points": 12,
                    "rounds": {"R1": 12.0},
                    "appearances": 1,
                    "points_per_appearance": 12.0,
                }
            ),
            "round value",
        ),
        (lambda record: record.update({"appearances": True}), "appearances"),
        (lambda record: record.update({"appearances": 2**53}), "safe integer"),
        (lambda record: record.update({"points_per_appearance": True}), "points per appearance"),
        (lambda record: record.update({"points_per_appearance": 10**400}), "points per appearance"),
    ],
)
def test_archive_preview_numbers_are_javascript_safe_without_exceptions(
    mutation: Any, reason: str
) -> None:
    record = enriched_archive_record()
    mutation(record)
    data = {"4711": [record]}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert reason in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    ("average", "expected"),
    [
        (4, Decision.PUBLISH),
        (4.0 + 5e-13, Decision.PUBLISH),
        (4.0 + 2e-12, Decision.BLOCKED),
    ],
)
def test_archive_preview_average_uses_absolute_plan_tolerance(
    average: int | float, expected: Decision
) -> None:
    record = {**enriched_archive_record(), "points_per_appearance": average}
    data = {"4711": [record]}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is expected


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (lambda record: record.pop("appearances"), "all-or-none"),
        (lambda record: record.update({"v_nr": ""}), "club number"),
        (lambda record: record.update({"v_nr": "01A"}), "club number"),
        (lambda record: record.update({"rounds": {"round 1": 12}}), "round key"),
        (lambda record: record.update({"rounds": {"R1": True, "R2": 12}}), "round value"),
        (lambda record: record.update({"rounds": {"R1": -1, "R2": 13}}), "round value"),
        (lambda record: record.update({"rounds": {"R1": []}}), "round value"),
        (
            lambda record: record.update(
                {
                    "rounds": {},
                    "points": 0,
                    "appearances": 0,
                    "points_per_appearance": 0.0,
                }
            ),
            "rounds",
        ),
        (lambda record: record.update({"appearances": 2}), "appearances"),
        (lambda record: record.update({"points": 11}), "round sum"),
        (lambda record: record.update({"points_per_appearance": 4.0000001}), "points per appearance"),
        (lambda record: record.update({"name": "  "}), "name"),
        (lambda record: record.update({"rank": True}), "rank"),
        (lambda record: record.update({"points": True}), "points"),
    ],
)
def test_archive_payload_rejects_inconsistent_preview_evidence(
    mutation: Any, reason: str
) -> None:
    previous = {"4711": [legacy_preview_record()]}
    candidate_record = enriched_archive_record()
    mutation(candidate_record)
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]}, previous, tables, tables
    )

    assert result.decision is Decision.BLOCKED
    assert reason in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    ("player_key", "record_id"),
    [
        ("47A1", None),
        ("٤٧١١", None),
        ("4711", "47A1"),
        ("4711", "٤٧١١"),
        ("4711", "9999"),
    ],
)
def test_archive_preview_identity_requires_matching_ascii_digit_id(
    player_key: str, record_id: str | None
) -> None:
    record = enriched_archive_record()
    if record_id is not None:
        record["id"] = record_id
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {player_key: [record]}, {player_key: [deepcopy(record)]}, tables, tables
    )

    assert result.decision is Decision.BLOCKED
    assert "player id" in " ".join(result.reasons).lower()


def test_archive_preview_accepts_matching_explicit_player_id() -> None:
    record = {**enriched_archive_record(), "id": "4711"}
    data = {"4711": [record]}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.PUBLISH


def test_archive_preview_counts_numeric_zero_as_an_appearance() -> None:
    record = enriched_archive_record()
    record["rounds"] = {"R1": 0}
    record["points"] = 0
    record["appearances"] = 1
    record["points_per_appearance"] = 0.0
    data = {"4711": [record]}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.PUBLISH


def test_archive_payload_allows_one_lossless_legacy_to_enriched_migration() -> None:
    previous_record = legacy_preview_record()
    candidate_record = enriched_archive_record()
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]}, {"4711": [previous_record]}, tables, tables
    )

    assert result.decision is Decision.PUBLISH


@pytest.mark.parametrize(
    ("candidate_v_nr", "expected"),
    [("018", Decision.PUBLISH), ("019", Decision.BLOCKED)],
)
def test_archive_payload_preserves_existing_legacy_club_number(
    candidate_v_nr: str, expected: Decision
) -> None:
    previous_record = {**legacy_preview_record(), "v_nr": "018"}
    candidate_record = {**enriched_archive_record(), "v_nr": candidate_v_nr}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]},
        {"4711": [previous_record]},
        tables,
        tables,
    )

    assert result.decision is expected


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("season", "25/26"),
        ("league", "B-Klasse"),
        ("rank", 2),
        ("name", "Other Player"),
        ("points", 13),
    ],
)
def test_archive_payload_blocks_lossy_core_change_during_enrichment(
    field: str, value: Any
) -> None:
    previous_record = legacy_preview_record()
    candidate_record = enriched_archive_record()
    candidate_record[field] = value
    candidate_tables = [archive_table(str(candidate_record["season"]))]
    previous_tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]},
        {"4711": [previous_record]},
        candidate_tables,
        previous_tables,
    )

    assert result.decision is Decision.BLOCKED
    assert "lost 1 record" in " ".join(result.reasons).lower()


def approved_legacy_cleanup_records() -> dict[str, list[dict[str, Any]]]:
    return {
        "10": [{
            "season": "24/25",
            "rank": 1,
            "points": 216,
            "league": "C-Klasse",
            "name": "Matteo P.",
        }],
        "14": [{
            "season": "24/25",
            "rank": 7,
            "points": 127,
            "league": "C-Klasse",
            "name": "x",
        }],
    }


def test_archive_payload_allows_only_two_exact_approved_legacy_removals() -> None:
    previous = {
        **approved_legacy_cleanup_records(),
        "4711": [archive_record("24/25")],
    }
    candidate = {"4711": [archive_record("24/25")]}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        candidate, previous, tables, tables
    )

    assert result.decision is Decision.PUBLISH
    assert result.reasons == ()
    assert result.metrics["approved_legacy_removals"] == 2


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("season", "23/24"),
        ("rank", 2),
        ("points", 215),
        ("league", "B-Klasse"),
        ("name", "Matteo P"),
        ("source", "legacy"),
    ],
)
def test_archive_payload_does_not_partially_match_approved_legacy_removal(
    field: str, value: Any
) -> None:
    previous = {
        **approved_legacy_cleanup_records(),
        "4711": [archive_record("24/25")],
    }
    previous["10"][0][field] = value
    candidate = {"4711": [archive_record("24/25")]}
    tables = [archive_table("24/25"), archive_table("23/24")]

    result = validation.validate_archive_payloads(
        candidate, previous, tables, tables
    )

    assert result.decision is Decision.BLOCKED
    assert result.metrics["approved_legacy_removals"] == 1
    assert "missing previous player: 10" in " ".join(result.reasons).lower()


def test_archive_payload_blocks_additional_loss_beside_approved_removals() -> None:
    previous = {
        **approved_legacy_cleanup_records(),
        "4711": [archive_record("24/25")],
        "999": [archive_record("24/25", rank=9)],
    }
    candidate = {"4711": [archive_record("24/25")]}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        candidate, previous, tables, tables
    )

    assert result.decision is Decision.BLOCKED
    assert result.metrics["approved_legacy_removals"] == 2
    assert "missing previous player: 999" in " ".join(result.reasons).lower()


def test_archive_payload_blocks_ambiguous_legacy_enrichment_deterministically() -> None:
    previous = {"4711": [legacy_preview_record()]}
    first = enriched_archive_record()
    second = deepcopy(first)
    second["rounds"] = {"R1": 4, "R2": 8}
    second["appearances"] = 2
    second["points_per_appearance"] = 6.0
    candidate = {"4711": [first, second]}
    tables = [archive_table("24/25")]

    forward = validation.validate_archive_payloads(candidate, previous, tables, tables)
    reverse = validation.validate_archive_payloads(
        {"4711": list(reversed(candidate["4711"]))}, previous, tables, tables
    )

    assert forward.decision is Decision.BLOCKED
    assert forward.reasons == reverse.reasons
    assert "ambiguous" in " ".join(forward.reasons).lower()


def test_archive_payload_requires_migration_to_preserve_legacy_extra_fields() -> None:
    previous_record = {**legacy_preview_record(), "source_label": "published"}
    candidate_record = {**enriched_archive_record(), "source_label": "rewritten"}
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]},
        {"4711": [previous_record]},
        tables,
        tables,
    )

    assert result.decision is Decision.BLOCKED
    assert "lost 1 record" in " ".join(result.reasons).lower()


def test_archive_payload_does_not_rewrite_published_preview_evidence() -> None:
    previous_record = enriched_archive_record()
    candidate_record = deepcopy(previous_record)
    candidate_record["rounds"] = {"R1": 6, "R2": 6}
    candidate_record["appearances"] = 2
    candidate_record["points_per_appearance"] = 6.0
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]},
        {"4711": [previous_record]},
        tables,
        tables,
    )

    assert result.decision is Decision.BLOCKED
    assert "lost 1 record" in " ".join(result.reasons).lower()


def test_archive_payload_rejects_non_json_nested_types() -> None:
    previous_data = {"4711": [archive_record("24/25")]}
    candidate_data = deepcopy(previous_data)
    candidate_data["811"] = [{**archive_record("25/26"), "extra": ("tuple",)}]
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        candidate_data, previous_data, tables, tables
    )

    assert result.decision is Decision.BLOCKED
    assert "strict json" in " ".join(result.reasons).lower()


def test_archive_payload_accepts_strict_v2_segments_and_reports_metrics() -> None:
    record = segmented_archive_record(segments=[{
        "league": "A-Klasse",
        "rank": 1,
        "name": "Player",
        "points": 0,
        "v_nr": "018",
        "rounds": {
            "R1": "x", "R2": "VW", "R3": "Vw", "R4": "D",
            "R5": "d", "R6": "kp", "R7": "*", "R8": 0,
        },
        "appearances": 1,
        "points_per_appearance": 0.0,
    }])
    data = {"4711": [record]}
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.PUBLISH
    assert result.metrics["containers"] == 1
    assert result.metrics["segments"] == 1
    assert result.metrics["administrative_markers"] == 7
    assert result.metrics["totals_only_segments"] == 0
    assert result.metrics["preview_eligible_segments"] == 1
    assert result.metrics["identity_ambiguities"] == 0
    assert result.metrics["round_overlap_ambiguities"] == 0


def test_archive_payload_accepts_segment_affiliation_marker_as_performance_only() -> None:
    record = segmented_archive_record(player_id="746", segments=[{
        "league": "Bezirksliga", "rank": 59, "name": "Tarkan Arik",
        "points": 3, "affiliation_marker": "Vw",
        "rounds": {"R1": "x", "R2": 3}, "appearances": 1,
        "points_per_appearance": 3.0,
    }])
    data = {"746": [record]}
    tables = [archive_table("2024/2025", league="Bezirksliga")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.PUBLISH
    assert result.metrics["segments"] == 1
    assert result.metrics["preview_eligible_segments"] == 1
    assert record["segments"][0]["affiliation_marker"] == "Vw"
    assert "affiliation_marker" not in record


@pytest.mark.parametrize("marker", [" VW ", "Ｖｗ", "ZZ", "", 7])
def test_archive_payload_rejects_noncanonical_or_unknown_affiliation_marker(
    marker: Any,
) -> None:
    record = segmented_archive_record(player_id="746", segments=[{
        "league": "Bezirksliga", "rank": 59, "name": "Tarkan Arik",
        "points": 3, "affiliation_marker": "Vw",
        "rounds": {"R1": 3}, "appearances": 1,
        "points_per_appearance": 3.0,
    }])
    record["segments"][0]["affiliation_marker"] = marker
    data = {"746": [record]}
    tables = [archive_table("2024/2025", league="Bezirksliga")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "affiliation marker" in " ".join(result.reasons).lower()


def test_archive_payload_rejects_affiliation_marker_with_numeric_club() -> None:
    record = segmented_archive_record(player_id="746", segments=[{
        "league": "Bezirksliga", "rank": 59, "name": "Tarkan Arik",
        "points": 3, "affiliation_marker": "Vw",
        "rounds": {"R1": 3}, "appearances": 1,
        "points_per_appearance": 3.0,
    }])
    record["segments"][0]["v_nr"] = "035"
    data = {"746": [record]}
    tables = [archive_table("2024/2025", league="Bezirksliga")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "mutually exclusive" in " ".join(result.reasons).lower()


def test_legacy_archive_schema_does_not_gain_affiliation_marker() -> None:
    record = enriched_archive_record()
    record.pop("v_nr")
    record["affiliation_marker"] = "Vw"
    data = {"746": [record]}
    previous = deepcopy(record)
    previous.pop("affiliation_marker")
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(data, {"746": [previous]}, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "schema drift" in " ".join(result.reasons).lower()


def _two_segment_archive_record() -> dict[str, Any]:
    return segmented_archive_record(segments=[
        {
            "league": "A-Klasse", "rank": 1, "name": "Player", "points": 5,
            "v_nr": "018", "rounds": {"R1": 5}, "appearances": 1,
            "points_per_appearance": 5.0,
        },
        {
            "league": "B-Klasse", "rank": 2, "name": "Player", "points": 7,
            "v_nr": "019", "rounds": {"R1": 7}, "appearances": 1,
            "points_per_appearance": 7.0,
        },
    ])


@pytest.mark.parametrize(
    "mutation",
    [
        lambda record: record.update({"points": record["points"] + 1}),
        lambda record: record.update({"rank": record["rank"] + 1}),
        lambda record: record.update({"league": "C-Klasse"}),
        lambda record: record.update({"name": "Wrong projection"}),
        lambda record: record.update({"primary_segment_id": "sha256:" + "0" * 64}),
        lambda record: record["segments"].reverse(),
        lambda record: record["segments"][0].update(
            {"segment_id": "sha256:" + "0" * 64}
        ),
        lambda record: record["segments"][0].update({"appearances": 2}),
        lambda record: record["segments"][0].update({"points_per_appearance": 5.5}),
        lambda record: record["segments"][0]["rounds"].update({"R2": "?"}),
        lambda record: record["segments"][0]["rounds"].update({"R2": " VW "}),
        lambda record: record.update({"v_nr": "018"}),
    ],
)
def test_archive_payload_recomputes_all_v2_ids_order_and_derived_fields(
    mutation: Any,
) -> None:
    record = _two_segment_archive_record()
    mutation(record)
    data = {"4711": [record]}
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED


def test_archive_payload_rejects_duplicate_v2_segment_identity() -> None:
    record = _two_segment_archive_record()
    record["segments"].append(deepcopy(record["segments"][0]))
    data = {"4711": [record]}
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "segment" in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda record: record["segments"][0].update({"rank": 2**53}),
        lambda record: record["segments"][0].update({"points": 2**53}),
        lambda record: record["segments"][0]["rounds"].update({"R1": 2**53}),
        lambda record: record["segments"][0].update({"appearances": 2**53}),
    ],
)
def test_archive_payload_rejects_unsafe_v2_segment_numbers(mutation: Any) -> None:
    record = segmented_archive_record()
    mutation(record)
    data = {"4711": [record]}
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "safe integer" in " ".join(result.reasons).lower()


def test_archive_payload_rejects_unsafe_v2_container_sum() -> None:
    record = _two_segment_archive_record()
    for index, segment in enumerate(record["segments"]):
        segment["points"] = 2**53 - 1
        segment["rounds"] = {"R1": 2**53 - 1}
        segment["appearances"] = 1
        segment["points_per_appearance"] = float(2**53 - 1)
        segment["segment_id"] = f"sha256:{index + 1:064x}"
    record["points"] = 2**53 - 1
    data = {"4711": [record]}
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "safe integer" in " ".join(result.reasons).lower()


def test_archive_payload_recomputes_identity_and_overlap_ambiguity_flags() -> None:
    identity = segmented_archive_record(segments=[
        {"league": "A-Klasse", "rank": 1, "name": "First Name", "points": 5},
        {"league": "B-Klasse", "rank": 2, "name": "Other Name", "points": 7},
    ])
    overlap = segmented_archive_record(player_id="811", segments=[
        {
            "league": "A-Klasse", "rank": 1, "name": "Other", "points": 5,
            "v_nr": "018", "rounds": {"R1": 5}, "appearances": 1,
            "points_per_appearance": 5.0,
        },
        {
            "league": "A-Klasse", "rank": 2, "name": "Other", "points": 7,
            "v_nr": "018", "rounds": {"R1": 7}, "appearances": 1,
            "points_per_appearance": 7.0,
        },
    ])
    data = {"4711": [identity], "811": [overlap]}
    tables = [archive_table("2024/2025")]

    valid = validation.validate_archive_payloads(data, data, tables, tables)
    assert valid.decision is Decision.PUBLISH
    assert valid.metrics["identity_ambiguities"] == 1
    assert valid.metrics["round_overlap_ambiguities"] == 1
    assert valid.metrics["preview_eligible_segments"] == 0

    missing_identity = deepcopy(data)
    missing_identity["4711"][0].pop("identity_ambiguous")
    missing_overlap = deepcopy(data)
    missing_overlap["811"][0].pop("round_overlap_ambiguous")
    false_positive = deepcopy(data)
    false_positive["4711"] = [segmented_archive_record()]
    false_positive["4711"][0]["identity_ambiguous"] = True

    for candidate in (missing_identity, missing_overlap, false_positive):
        result = validation.validate_archive_payloads(candidate, data, tables, tables)
        assert result.decision is Decision.BLOCKED


def test_archive_payload_migrates_legacy_to_exactly_one_normalized_v2_segment() -> None:
    previous_record = archive_record("24/25")
    matching = {
        "league": " a-klasse ", "rank": 1, "name": " PLAYER ", "points": 10,
    }
    other = {"league": "B-Klasse", "rank": 3, "name": "Player", "points": 4}
    candidate_record = segmented_archive_record(segments=[matching, other])
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]}, {"4711": [previous_record]}, tables, tables
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_blocks_ambiguous_legacy_to_v2_segment_migration() -> None:
    previous_record = archive_record("24/25")
    candidate_record = segmented_archive_record(segments=[
        {"league": "A-Klasse", "rank": 1, "name": "Player", "points": 10,
         "v_nr": "018"},
        {"league": "A-Klasse", "rank": 1, "name": "Player", "points": 10,
         "v_nr": "019"},
    ])
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]}, {"4711": [previous_record]}, tables, tables
    )

    assert result.decision is Decision.BLOCKED
    assert "ambiguous" in " ".join(result.reasons).lower()


@pytest.mark.parametrize("change", ["remove", "rewrite"])
def test_archive_payload_blocks_published_v2_segment_loss_or_rewrite(change: str) -> None:
    previous_record = _two_segment_archive_record()
    source_segments = [
        {key: deepcopy(value) for key, value in segment.items() if key != "segment_id"}
        for segment in previous_record["segments"]
    ]
    if change == "remove":
        source_segments.pop()
    else:
        source_segments[0]["rounds"] = {"R1": 4, "R2": 1}
        source_segments[0]["appearances"] = 2
        source_segments[0]["points_per_appearance"] = 2.5
    candidate_record = segmented_archive_record(segments=source_segments)
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]}, {"4711": [previous_record]}, tables, tables
    )

    assert result.decision is Decision.BLOCKED
    assert "segment" in " ".join(result.reasons).lower()


def test_archive_payload_allows_additive_v2_segment_and_older_season() -> None:
    previous_record = segmented_archive_record()
    existing = {
        key: deepcopy(value)
        for key, value in previous_record["segments"][0].items()
        if key != "segment_id"
    }
    expanded = segmented_archive_record(segments=[
        existing,
        {"league": "B-Klasse", "rank": 2, "name": "Player", "points": 4},
    ])
    older = segmented_archive_record(season="2018/2019", segments=[
        {"league": "C-Klasse", "rank": 4, "name": "Player", "points": 3}
    ])
    candidate = {"4711": [expanded, older]}
    previous = {"4711": [previous_record]}
    candidate_tables = [archive_table("2024/2025"), archive_table("2018/2019")]
    previous_tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(
        candidate, previous, candidate_tables, previous_tables
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_requires_v2_season_containers_newest_first() -> None:
    newer = segmented_archive_record()
    older = segmented_archive_record(season="2018/2019")
    data = {"4711": [older, newer]}
    tables = [archive_table("2024/2025"), archive_table("2018/2019")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "newest-first" in " ".join(result.reasons).lower()


@pytest.mark.parametrize("invalid_season", ["2020/2099", "2020/99", "20/99"])
@pytest.mark.parametrize("schema", ["legacy", "v2", "tables"])
def test_archive_payload_rejects_season_spans_outside_producer_contract(
    invalid_season: str, schema: str
) -> None:
    data = {"4711": [archive_record("2020/2021")]}
    tables = [archive_table("2020/2021")]
    if schema == "legacy":
        data = {"4711": [archive_record(invalid_season)]}
    elif schema == "v2":
        record = segmented_archive_record(season="2020/2021")
        record["season"] = invalid_season
        data = {"4711": [record]}
    else:
        tables = [archive_table(invalid_season)]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "invalid season" in " ".join(result.reasons).lower()


def test_archive_payload_uses_producer_century_rollover_for_short_season() -> None:
    data = {"4711": [archive_record("99/00")]}
    tables = [archive_table("99/00")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "1999/00"


@pytest.mark.parametrize(
    "extra_value",
    ["new source", {"nested": 2**53}, {"safe_but_unknown": [1, 2, 3]}],
)
def test_archive_payload_blocks_new_unknown_v1_fields(extra_value: Any) -> None:
    previous = {"4711": [legacy_preview_record()]}
    candidate_record = enriched_archive_record()
    candidate_record["source_metadata"] = extra_value
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]}, previous, tables, tables
    )

    assert result.decision is Decision.BLOCKED
    assert "schema drift" in " ".join(result.reasons).lower()


def test_archive_payload_allows_byte_identical_grandfathered_v1_extra() -> None:
    previous_record = {
        **legacy_preview_record(),
        "source_metadata": {"published": ["legacy", 2**53]},
    }
    candidate_record = {
        **enriched_archive_record(),
        "source_metadata": {"published": ["legacy", 2**53]},
    }
    tables = [archive_table("24/25")]

    result = validation.validate_archive_payloads(
        {"4711": [candidate_record]},
        {"4711": [previous_record]},
        tables,
        tables,
    )

    assert result.decision is Decision.PUBLISH


def test_archive_payload_blocks_self_consistent_unknown_v2_segment_field() -> None:
    record = segmented_archive_record(segments=[{
        "league": "A-Klasse",
        "rank": 1,
        "name": "Player",
        "points": 10,
        "source_metadata": {"nested_unsafe": 2**53},
    }])
    data = {"4711": [record]}
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "schema drift" in " ".join(result.reasons).lower()


def test_archive_payload_blocks_unknown_v2_container_field() -> None:
    record = segmented_archive_record()
    record["source_metadata"] = {"nested_unsafe": 2**53}
    data = {"4711": [record]}
    tables = [archive_table("2024/2025")]

    result = validation.validate_archive_payloads(data, data, tables, tables)

    assert result.decision is Decision.BLOCKED
    assert "schema drift" in " ".join(result.reasons).lower()


@pytest.mark.parametrize(
    ("candidate", "previous", "expected_metrics"),
    [
        ({"2024/25"}, {"2024/25"}, {"candidate_seasons": 1, "previous_seasons": 1}),
        (
            {"2024/25", "2025/26"},
            {"2024/25"},
            {"candidate_seasons": 2, "previous_seasons": 1},
        ),
    ],
)
def test_equal_or_superset_archive_seasons_publish_deterministically(
    candidate: set[str], previous: set[str], expected_metrics: dict[str, int]
) -> None:
    result = validation.validate_archives(candidate, previous)

    assert result.decision is Decision.PUBLISH
    assert result.metrics == expected_metrics
    assert result.reasons == ()


@pytest.mark.parametrize("blank", ["", "   "])
def test_archive_rejects_blank_season_identifiers(blank: str) -> None:
    result = validation.validate_archives({"2025/26", blank}, set())

    assert result.decision is Decision.BLOCKED
    assert "blank" in " ".join(result.reasons).lower()


def test_parse_javascript_assignment_accepts_exact_german_json() -> None:
    payload = {"clubs": [{"name": "Dartfreunde Schömberg", "city": "Pforzheim"}]}
    text = "\n window.CLUB_DATA = " + json.dumps(payload, ensure_ascii=False) + "; \n"

    assert validation.parse_javascript_assignment(text, "CLUB_DATA") == payload


@pytest.mark.parametrize(
    ("text", "global_name"),
    [
        ('window.OTHER = {"x": 1};', "DATA"),
        ('window.DATA = {"x": 1}; alert(1)', "DATA"),
        ('window.DATA = {x: 1};', "DATA"),
        ('window.DATA = {"x": 1};', "not-valid"),
    ],
)
def test_parse_javascript_assignment_rejects_non_exact_input(
    text: str, global_name: str
) -> None:
    with pytest.raises(ValueError):
        validation.parse_javascript_assignment(text, global_name)


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_parse_javascript_assignment_rejects_non_json_constants(
    constant: str,
) -> None:
    with pytest.raises(ValueError, match="valid JSON"):
        validation.parse_javascript_assignment(
            f'window.DATA = {{"value": {constant}}};', "DATA"
        )


@pytest.mark.parametrize(
    "payload",
    [
        '{"value": 1, "value": 2}',
        '{"nested": {"value": 1, "value": 2}}',
    ],
)
def test_parse_javascript_assignment_rejects_duplicate_object_keys(
    payload: str,
) -> None:
    with pytest.raises(ValueError, match="valid JSON"):
        validation.parse_javascript_assignment(f"window.DATA = {payload};", "DATA")


def test_json_js_pair_accepts_equal_german_data() -> None:
    payload = {"club": "DC Ungültig", "city": "Königsbach"}
    javascript = "window.CLUB_DATA = " + json.dumps(payload, ensure_ascii=False) + ";"

    assert validation.validate_json_js_pair(payload, javascript, "CLUB_DATA") == (
        True,
        "",
    )


def test_json_js_pair_reports_mismatch_deterministically() -> None:
    assert validation.validate_json_js_pair(
        {"name": "Schömberg"}, 'window.DATA = {"name":"Pforzheim"};', "DATA"
    ) == (False, "JSON and JavaScript payloads differ")


@pytest.mark.parametrize(
    ("json_payload", "javascript"),
    [
        ({"value": True}, 'window.DATA = {"value": 1};'),
        (
            {"nested": [{"value": False}]},
            'window.DATA = {"nested": [{"value": 0}]};',
        ),
    ],
)
def test_json_js_pair_uses_strict_nested_json_types(
    json_payload: Any, javascript: str
) -> None:
    assert validation.validate_json_js_pair(
        json_payload, javascript, "DATA"
    ) == (False, "JSON and JavaScript payloads differ")


@pytest.mark.parametrize("invalid_payload", [{"value": {1, 2}}, {"value": float("nan")}])
def test_json_js_pair_reports_json_serialization_failures(
    invalid_payload: Any,
) -> None:
    assert validation.validate_json_js_pair(
        invalid_payload, 'window.DATA = {"value": null};', "DATA"
    ) == (False, "JSON payload is not valid canonical JSON")


@pytest.mark.parametrize(
    "javascript",
    ['window.OTHER = {"x": 1};', 'window.DATA = {"x": 1}; trailing'],
)
def test_json_js_pair_reports_parse_failures(javascript: str) -> None:
    valid, reason = validation.validate_json_js_pair({"x": 1}, javascript, "DATA")

    assert valid is False
    assert reason.startswith("Invalid JavaScript assignment:")


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_json_js_pair_reports_non_json_constants_deterministically(
    constant: str,
) -> None:
    result = validation.validate_json_js_pair(
        {"value": None}, f'window.DATA = {{"value": {constant}}};', "DATA"
    )

    assert result == (
        False,
        "Invalid JavaScript assignment: Assignment payload is not valid JSON",
    )
