from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Any

from bs4 import BeautifulSoup


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

EXPECTED_REGULAR_LEAGUES = 13
EXPECTED_MATCHDAYS = 18
MIN_CLUB_RATIO = 0.80


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


def _league_key_season(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    match = re.search(r"(\d{4}(?:/\d{2}|[/-]\d{4}))\s*$", value)
    return _parse_season(match.group(1)) if match is not None else None


def _normalized_text(value: str) -> str:
    return " ".join(value.split()).casefold()


def _league_table_issue(table: Any) -> str | None:
    if not isinstance(table, str) or not _is_ranking_table(table):
        return "malformed table"

    parsed = BeautifulSoup(table, "html.parser")
    rows = parsed.find_all("tr")
    if not rows:
        return "table has no header"

    teams: set[str] = set()
    found_team = False
    for row in rows[1:]:
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            return "table row is incomplete"
        team = _normalized_text(cells[1].get_text(" ", strip=True))
        if not team:
            return "blank team name"
        if team == "spielfrei":
            continue
        found_team = True
        if team in teams:
            return "duplicate team name"
        teams.add(team)

    if not found_team:
        return "table has no team"
    return None


def _matchday_issue(match_days: Any) -> str | None:
    if not isinstance(match_days, dict):
        return "malformed matchdays"
    if len(match_days) != EXPECTED_MATCHDAYS:
        return f"expected {EXPECTED_MATCHDAYS} matchdays"
    normalized_keys: set[str] = set()
    for key in match_days:
        if not isinstance(key, str) or not key.strip():
            return "blank matchday key"
        normalized_key = _normalized_text(key)
        if normalized_key in normalized_keys:
            return "duplicate matchday key"
        normalized_keys.add(normalized_key)
    return None


def validate_leagues(
    candidate: dict[str, Any], previous: dict[str, Any]
) -> ValidationResult:
    previous_season = _previous_season(previous)
    leagues = candidate.get("leagues")
    metrics = {"regular_leagues": 0}
    if not isinstance(leagues, dict):
        return ValidationResult(
            domain="leagues",
            decision=Decision.BLOCKED,
            effective_season=previous_season,
            reasons=("Malformed leagues structure",),
            metrics=metrics,
        )

    regular_seasons = [
        season
        for key in leagues
        if isinstance(key, str)
        and "ligapokal" not in key.casefold()
        and (season := _league_key_season(key)) is not None
    ]
    raw_explicit_season = candidate.get("season")
    if raw_explicit_season is not None:
        current_season = _parse_season(raw_explicit_season)
        if current_season is None:
            return ValidationResult(
                domain="leagues",
                decision=Decision.BLOCKED,
                effective_season=previous_season,
                reasons=("Invalid candidate season",),
                metrics=metrics,
            )
    else:
        current_season = max(
            regular_seasons,
            key=lambda season: int(season[:4]),
            default=None,
        )
        if current_season is None:
            return ValidationResult(
                domain="leagues",
                decision=Decision.BLOCKED,
                effective_season=previous_season,
                reasons=("Candidate season is missing",),
                metrics=metrics,
            )

    selected = [
        (key, value)
        for key, value in leagues.items()
        if isinstance(key, str)
        and "ligapokal" not in key.casefold()
        and _league_key_season(key) == current_season
    ]
    metrics["regular_leagues"] = len(selected)
    reasons: list[str] = []
    normalized_league_keys: set[str] = set()
    duplicate_league_keys = 0
    for key, _ in selected:
        normalized_key = _normalized_text(key)
        if normalized_key in normalized_league_keys:
            duplicate_league_keys += 1
        normalized_league_keys.add(normalized_key)
    if duplicate_league_keys:
        reasons.append(f"Duplicate current league keys: {duplicate_league_keys}")
    if raw_explicit_season is not None and regular_seasons and not selected:
        reasons.append("Explicit candidate season does not match league keys")
    if len(selected) != EXPECTED_REGULAR_LEAGUES:
        reasons.append(
            f"Expected {EXPECTED_REGULAR_LEAGUES} current regular leagues, found {len(selected)}"
        )

    for key, league in sorted(selected, key=lambda item: item[0].casefold()):
        if not isinstance(league, dict):
            reasons.append(f"Malformed league: {key}")
            continue
        table_issue = _league_table_issue(league.get("table"))
        if table_issue is not None:
            reasons.append(f"League {key}: {table_issue}")
        matchday_issue = _matchday_issue(league.get("match_days"))
        if matchday_issue is not None:
            reasons.append(f"League {key}: {matchday_issue}")

    if reasons:
        return ValidationResult(
            domain="leagues",
            decision=Decision.BLOCKED,
            effective_season=previous_season,
            reasons=reasons,
            metrics=metrics,
        )
    return ValidationResult(
        domain="leagues",
        decision=Decision.PUBLISH,
        effective_season=current_season,
        metrics=metrics,
    )


def validate_clubs(
    candidate: dict[str, Any], previous: dict[str, Any]
) -> ValidationResult:
    candidate_clubs = candidate.get("clubs")
    previous_clubs = previous.get("clubs", [])
    candidate_season = _parse_season(candidate.get("season"))
    effective_season = candidate_season or _previous_season(previous)
    metrics = {
        "clubs": len(candidate_clubs) if isinstance(candidate_clubs, list) else 0
    }
    reasons: list[str] = []

    if not isinstance(candidate_clubs, list):
        reasons.append("Malformed clubs structure")
    else:
        seen_numbers: set[str] = set()
        for index, club in enumerate(candidate_clubs, 1):
            if not isinstance(club, dict):
                reasons.append(f"Club {index} is malformed")
                continue
            name = club.get("name")
            number = club.get("number")
            if not isinstance(name, str) or not name.strip():
                reasons.append(f"Club {index} has a blank name")
            if not isinstance(number, str) or not number.strip():
                reasons.append(f"Club {index} has a blank number")
                continue
            normalized_number = _normalized_text(number)
            if normalized_number in seen_numbers:
                reasons.append(f"Duplicate club number: {number.strip()}")
            seen_numbers.add(normalized_number)

        previous_count = len(previous_clubs) if isinstance(previous_clubs, list) else 0
        if not candidate_clubs:
            reasons.append("Empty club candidate cannot be published")
        elif previous_count and len(candidate_clubs) < previous_count * MIN_CLUB_RATIO:
            reasons.append("Club count is below 80% of the previous count")

    if reasons:
        return ValidationResult(
            domain="clubs",
            decision=Decision.BLOCKED,
            effective_season=_previous_season(previous),
            reasons=reasons,
            metrics=metrics,
        )
    return ValidationResult(
        domain="clubs",
        decision=Decision.PUBLISH,
        effective_season=effective_season,
        metrics=metrics,
    )


def validate_archives(
    candidate_seasons: set[str], previous_seasons: set[str]
) -> ValidationResult:
    metrics = {
        "candidate_seasons": len(candidate_seasons),
        "previous_seasons": len(previous_seasons),
    }
    previous_effective = max(previous_seasons, default="unknown")
    blank_identifiers = sorted(
        season
        for season in candidate_seasons | previous_seasons
        if not isinstance(season, str) or not season.strip()
    )
    if blank_identifiers:
        return ValidationResult(
            domain="archives",
            decision=Decision.BLOCKED,
            effective_season=previous_effective,
            reasons=("Blank archive season identifier",),
            metrics=metrics,
        )

    if not previous_seasons:
        return ValidationResult(
            domain="archives",
            decision=Decision.BLOCKED,
            effective_season="unknown",
            reasons=("Previous archive baseline is empty",),
            metrics=metrics,
        )

    missing = sorted(previous_seasons - candidate_seasons)
    if missing:
        return ValidationResult(
            domain="archives",
            decision=Decision.BLOCKED,
            effective_season=previous_effective,
            reasons=tuple(f"Missing archive season: {season}" for season in missing),
            metrics=metrics,
        )
    return ValidationResult(
        domain="archives",
        decision=Decision.PUBLISH,
        effective_season=max(candidate_seasons, default="unknown"),
        metrics=metrics,
    )


def parse_javascript_assignment(text: str, global_name: str) -> Any:
    if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", global_name) is None:
        raise ValueError("Invalid JavaScript global name")
    if not isinstance(text, str):
        raise ValueError("JavaScript assignment must be text")
    assignment = re.fullmatch(
        rf"\s*window\.{re.escape(global_name)}\s*=\s*(.+)\s*;\s*",
        text,
        flags=re.DOTALL,
    )
    if assignment is None:
        raise ValueError(f"Expected assignment to window.{global_name}")
    try:
        return json.loads(assignment.group(1))
    except json.JSONDecodeError as error:
        raise ValueError("Assignment payload is not valid JSON") from error


def validate_json_js_pair(
    json_payload: Any, javascript_text: str, global_name: str
) -> tuple[bool, str]:
    try:
        javascript_payload = parse_javascript_assignment(
            javascript_text, global_name
        )
    except ValueError as error:
        return False, f"Invalid JavaScript assignment: {error}"
    if javascript_payload != json_payload:
        return False, "JSON and JavaScript payloads differ"
    return True, ""
