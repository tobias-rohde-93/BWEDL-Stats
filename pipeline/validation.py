from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
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
    reasons: tuple[str, ...] = field(default_factory=tuple)
    metrics: Mapping[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "reasons", tuple(self.reasons))
        object.__setattr__(self, "metrics", MappingProxyType(dict(self.metrics)))

    def to_dict(self) -> dict[str, Any]:
        return {
            "domain": self.domain,
            "decision": self.decision.value,
            "effective_season": self.effective_season,
            "reasons": list(self.reasons),
            "metrics": dict(self.metrics),
        }


REQUIRED_RANKING_CATEGORIES = (
    "Bezirksliga",
    "A-Klasse",
    "B-Klasse",
    "C-Klasse",
)


def _parse_season(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized_value = value.strip()
    short_match = re.fullmatch(r"(\d{4})/(\d{2})", normalized_value)
    if short_match is not None:
        start_year, short_end_year = (int(part) for part in short_match.groups())
        if short_end_year == (start_year + 1) % 100:
            return f"{start_year}/{short_end_year:02d}"
        return None

    long_match = re.fullmatch(r"(\d{4})([/-])(\d{4})", normalized_value)
    if long_match is None:
        return None
    start_year = int(long_match.group(1))
    end_year = int(long_match.group(3))
    if end_year != start_year + 1:
        return None
    return f"{start_year}/{end_year % 100:02d}"


def _parse_category(value: Any) -> tuple[str, str | None] | None:
    if not isinstance(value, str):
        return None
    for category in REQUIRED_RANKING_CATEGORIES:
        if value == category:
            return category, None
        prefix = f"{category} "
        if value.startswith(prefix):
            season = _parse_season(value[len(prefix) :])
            return (category, season) if season is not None else None
    return None


def _is_ranking_table(value: str) -> bool:
    return (
        re.fullmatch(
            r"\s*<table\b[^>]*>(?:(?!<table\b|</table>).)*</table>\s*",
            value,
            flags=re.IGNORECASE | re.DOTALL,
        )
        is not None
    )


def _previous_season(previous: dict[str, Any]) -> str:
    season = previous.get("season")
    return season.strip() if isinstance(season, str) and season.strip() else "unknown"


def validate_rankings(
    candidate: dict[str, Any], previous: dict[str, Any]
) -> ValidationResult:
    effective_previous_season = _previous_season(previous)
    metrics = {category: 0 for category in REQUIRED_RANKING_CATEGORIES}
    reasons: list[str] = []
    raw_candidate_season = candidate.get("season")
    candidate_season = _parse_season(raw_candidate_season)
    invalid_candidate_season = (
        raw_candidate_season is not None
        and not (
            isinstance(raw_candidate_season, str)
            and not raw_candidate_season.strip()
        )
        and candidate_season is None
    )

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
    invalid_player_categories = 0
    duplicate_players = 0
    observed_suffix_seasons: list[str] = []
    player_ids_by_category = {
        category: set() for category in REQUIRED_RANKING_CATEGORIES
    }

    for player in players:
        if not isinstance(player, dict):
            invalid_players += 1
            continue

        player_id = player.get("id")
        name = player.get("name")
        parsed_category = _parse_category(player.get("league"))
        valid_id = isinstance(player_id, str) and player_id.strip() != ""
        valid_name = isinstance(name, str) and name.strip() != ""
        if parsed_category is None:
            invalid_players += 1
            invalid_player_categories += 1
            continue
        if not valid_id or not valid_name:
            invalid_players += 1
            continue

        category, category_season = parsed_category
        if category_season is not None:
            observed_suffix_seasons.append(category_season)

        normalized_id = player_id.strip()
        if normalized_id in player_ids_by_category[category]:
            duplicate_players += 1
            continue

        player_ids_by_category[category].add(normalized_id)
        metrics[category] += 1

    if invalid_players:
        metrics["invalid_players"] = invalid_players
        reasons.append(f"Invalid players: {invalid_players}")
    if invalid_player_categories:
        metrics["invalid_player_categories"] = invalid_player_categories
        reasons.append(f"Invalid player category labels: {invalid_player_categories}")
    if duplicate_players:
        metrics["duplicate_players"] = duplicate_players
        reasons.append(f"Duplicate players within a category: {duplicate_players}")
    if invalid_candidate_season:
        metrics["invalid_candidate_seasons"] = 1
        reasons.append("Invalid candidate season")

    ranking_categories: set[str] = set()
    seen_ranking_categories: set[str] = set()
    invalid_ranking_categories = 0
    duplicate_ranking_categories = 0
    malformed_ranking_tables = 0
    for key, table in rankings.items():
        parsed_category = _parse_category(key)
        if parsed_category is None:
            invalid_ranking_categories += 1
            continue

        category, category_season = parsed_category
        if category in seen_ranking_categories:
            duplicate_ranking_categories += 1
        else:
            seen_ranking_categories.add(category)
        if category_season is not None:
            observed_suffix_seasons.append(category_season)
        if not isinstance(table, str):
            malformed_ranking_tables += 1
            continue
        if not table.strip():
            continue
        if not _is_ranking_table(table):
            malformed_ranking_tables += 1
            continue
        ranking_categories.add(category)

    if invalid_ranking_categories:
        metrics["invalid_ranking_categories"] = invalid_ranking_categories
        reasons.append(
            f"Invalid ranking category labels: {invalid_ranking_categories}"
        )
    if duplicate_ranking_categories:
        metrics["duplicate_ranking_categories"] = duplicate_ranking_categories
        reasons.append(
            f"Duplicate canonical ranking categories: {duplicate_ranking_categories}"
        )
    if malformed_ranking_tables:
        metrics["malformed_ranking_tables"] = malformed_ranking_tables
        reasons.append(f"Malformed ranking tables: {malformed_ranking_tables}")

    unique_suffix_seasons = set(observed_suffix_seasons)
    if len(unique_suffix_seasons) > 1:
        metrics["conflicting_suffix_seasons"] = len(unique_suffix_seasons)
        reasons.append(
            f"Conflicting category suffix seasons: {len(unique_suffix_seasons)}"
        )
    season_mismatches = (
        sum(season != candidate_season for season in observed_suffix_seasons)
        if candidate_season is not None
        else 0
    )
    if season_mismatches:
        metrics["season_mismatches"] = season_mismatches
        reasons.append(f"Category season mismatches: {season_mismatches}")

    if reasons:
        return ValidationResult(
            domain="rankings",
            decision=Decision.BLOCKED,
            effective_season=effective_previous_season,
            reasons=reasons,
            metrics=metrics,
        )

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

    if candidate_season is None:
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
        effective_season=candidate_season,
        metrics=metrics,
    )
