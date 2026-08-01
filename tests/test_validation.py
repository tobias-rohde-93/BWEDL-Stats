from pipeline.validation import Decision, validate_rankings


REQUIRED_CATEGORIES = (
    "Bezirksliga",
    "A-Klasse",
    "B-Klasse",
    "C-Klasse",
)


def player(player_id: str, name: str, league: str) -> dict[str, str]:
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
    assert result.reasons == []


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
