from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Decision(StrEnum):
    PUBLISH = "publish"
    RETAIN = "retain"
    BLOCKED = "blocked"
    FAILED = "failed"


@dataclass(frozen=True)
class ValidationResult:
    domain: str
    decision: Decision
    effective_season: str
    reasons: list[str] = field(default_factory=list)
    metrics: dict[str, int] = field(default_factory=dict)


REQUIRED_RANKING_CATEGORIES = (
    "Bezirksliga",
    "A-Klasse",
    "B-Klasse",
    "C-Klasse",
)


def _canonical_category(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    for category in REQUIRED_RANKING_CATEGORIES:
        if value == category or value.startswith(f"{category} "):
            return category
    return None


def _previous_season(previous: dict[str, Any]) -> str:
    season = previous.get("season")
    return season.strip() if isinstance(season, str) and season.strip() else "unknown"


def validate_rankings(
    candidate: dict[str, Any], previous: dict[str, Any]
) -> ValidationResult:
    effective_previous_season = _previous_season(previous)
    metrics = {category: 0 for category in REQUIRED_RANKING_CATEGORIES}
    reasons: list[str] = []

    players = candidate.get("players", [])
    rankings = candidate.get("rankings", {})
    if not isinstance(players, list) or not isinstance(rankings, dict):
        reasons.append("Malformed players or rankings structure")
        return ValidationResult(
            domain="rankings",
            decision=Decision.BLOCKED,
            effective_season=effective_previous_season,
            reasons=reasons,
            metrics=metrics,
        )

    invalid_players = 0
    duplicate_players = 0
    player_ids_by_category = {
        category: set() for category in REQUIRED_RANKING_CATEGORIES
    }

    for player in players:
        if not isinstance(player, dict):
            invalid_players += 1
            continue

        player_id = player.get("id")
        name = player.get("name")
        category = _canonical_category(player.get("league"))
        valid_id = player_id is not None and str(player_id).strip() != ""
        valid_name = isinstance(name, str) and name.strip() != ""
        if not valid_id or not valid_name or category is None:
            invalid_players += 1
            continue

        normalized_id = str(player_id).strip()
        if normalized_id in player_ids_by_category[category]:
            duplicate_players += 1
            continue

        player_ids_by_category[category].add(normalized_id)
        metrics[category] += 1

    if invalid_players:
        metrics["invalid_players"] = invalid_players
        reasons.append(f"Invalid players: {invalid_players}")
    if duplicate_players:
        metrics["duplicate_players"] = duplicate_players
        reasons.append(f"Duplicate players within a category: {duplicate_players}")
    if reasons:
        return ValidationResult(
            domain="rankings",
            decision=Decision.BLOCKED,
            effective_season=effective_previous_season,
            reasons=reasons,
            metrics=metrics,
        )

    ranking_categories = {
        category
        for key, table in rankings.items()
        if (category := _canonical_category(key)) is not None
        and table is not None
        and str(table).strip() != ""
    }
    missing_categories = [
        category
        for category in REQUIRED_RANKING_CATEGORIES
        if metrics[category] == 0 or category not in ranking_categories
    ]
    if missing_categories:
        reasons.extend(
            f"Missing ready category: {category}" for category in missing_categories
        )
        return ValidationResult(
            domain="rankings",
            decision=Decision.RETAIN,
            effective_season=effective_previous_season,
            reasons=reasons,
            metrics=metrics,
        )

    season = candidate.get("season")
    if not isinstance(season, str) or not season.strip():
        return ValidationResult(
            domain="rankings",
            decision=Decision.BLOCKED,
            effective_season=effective_previous_season,
            reasons=["Candidate season is missing"],
            metrics=metrics,
        )

    return ValidationResult(
        domain="rankings",
        decision=Decision.PUBLISH,
        effective_season=season.strip(),
        metrics=metrics,
    )
