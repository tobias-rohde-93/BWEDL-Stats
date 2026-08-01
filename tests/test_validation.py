from copy import deepcopy
from typing import Any

import pytest

from pipeline.validation import Decision, ValidationResult, validate_rankings


REQUIRED_CATEGORIES = (
    "Bezirksliga",
    "A-Klasse",
    "B-Klasse",
    "C-Klasse",
)


def player(player_id: Any, name: str, league: str) -> dict[str, Any]:
    return {"id": player_id, "name": name, "league": league}


def candidate_for(categories: tuple[str, ...], season: str | None = "2026/27") -> dict:
    candidate = {
        "rankings": {category: f"<table>{category}</table>" for category in categories},
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


def test_empty_ranking_table_retains_previous_season(prior_rankings: dict) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"]["Bezirksliga"] = "   "

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.RETAIN
    assert result.effective_season == "2025/26"


def test_ranking_table_tags_are_case_insensitive(prior_rankings: dict) -> None:
    candidate = candidate_for(REQUIRED_CATEGORIES)
    candidate["rankings"] = {
        category: f"<TABLE>{category}</TABLE>" for category in REQUIRED_CATEGORIES
    }

    result = validate_rankings(candidate, prior_rankings)

    assert result.decision is Decision.PUBLISH


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
