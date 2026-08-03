from __future__ import annotations

import json
import math
import re
import unicodedata
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


@dataclass(frozen=True)
class _ArchiveTableRecord:
    canonical_season: str
    canonical_title_identity: tuple[str, str]
    row_count: int
    rows_fingerprint: str
    label: str


REQUIRED_RANKING_CATEGORIES = (
    "Bezirksliga",
    "A-Klasse",
    "B-Klasse",
    "C-Klasse",
)

MIN_REGULAR_LEAGUES = 13
EXPECTED_MATCHDAYS = 18
MIN_CLUB_RATIO = 0.80
MIN_STANDINGS_COLUMNS = 9
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
    header_cells = rows[0].find_all(["td", "th"])
    column_count = len(header_cells)
    if column_count < MIN_STANDINGS_COLUMNS:
        return f"table has fewer than {MIN_STANDINGS_COLUMNS} columns"

    teams: set[str] = set()
    found_team = False
    for row in rows[1:]:
        cells = row.find_all(["td", "th"])
        if len(cells) != column_count:
            return "table row has inconsistent columns"
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
    matchday_numbers: set[int] = set()
    for key, value in match_days.items():
        if not isinstance(key, str):
            return "invalid matchday key"
        key_match = re.fullmatch(r"\s*(\d+)\.\s*Spieltag\s*", key, re.IGNORECASE)
        if key_match is None:
            return "invalid matchday sequence"
        matchday_number = int(key_match.group(1))
        if matchday_number in matchday_numbers:
            return "duplicate matchday number"
        matchday_numbers.add(matchday_number)

        if not isinstance(value, str):
            return "matchday value must be a string"
        if value == "---":
            continue
        for line in value.splitlines():
            if line.strip() and re.search(
                r"\d{1,2}\.\s*\d{1,2}\.\s*\d{4}", line
            ) is None:
                return "matchday line has no supported date"
    if matchday_numbers != set(range(1, EXPECTED_MATCHDAYS + 1)):
        return f"matchday sequence must cover 1 through {EXPECTED_MATCHDAYS}"
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
    newest_inferred_season = max(
        regular_seasons,
        key=lambda season: int(season[:4]),
        default=None,
    )
    if newest_inferred_season is None:
        return ValidationResult(
            domain="leagues",
            decision=Decision.BLOCKED,
            effective_season=previous_season,
            reasons=("Candidate season cannot be inferred",),
            metrics=metrics,
        )

    raw_explicit_season = candidate.get("season")
    if raw_explicit_season is not None:
        explicit_season = _parse_season(raw_explicit_season)
        if explicit_season is None:
            return ValidationResult(
                domain="leagues",
                decision=Decision.BLOCKED,
                effective_season=previous_season,
                reasons=("Invalid candidate season",),
                metrics=metrics,
            )
        if explicit_season != newest_inferred_season:
            return ValidationResult(
                domain="leagues",
                decision=Decision.BLOCKED,
                effective_season=previous_season,
                reasons=("Explicit candidate season is not the newest inferred season",),
                metrics=metrics,
            )
    current_season = newest_inferred_season

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
    if len(selected) < MIN_REGULAR_LEAGUES:
        reasons.append(
            f"Expected at least {MIN_REGULAR_LEAGUES} current regular leagues, found {len(selected)}"
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


def _club_record_issues(records: list[Any], label: str) -> list[str]:
    reasons: list[str] = []
    seen_numbers: set[str] = set()
    for index, club in enumerate(records, 1):
        if not isinstance(club, dict):
            reasons.append(f"{label} club {index} is malformed")
            continue

        name = club.get("name")
        number = club.get("number")
        if not isinstance(name, str) or not name.strip():
            reasons.append(f"{label} club {index} has a blank name")
        if not isinstance(number, str) or not number.strip():
            reasons.append(f"{label} club {index} has a blank number")
        else:
            normalized_number = _normalized_text(number)
            if normalized_number in seen_numbers:
                reasons.append(f"Duplicate {label.lower()} club number: {number.strip()}")
            seen_numbers.add(normalized_number)

        for field_name in OPTIONAL_CLUB_FIELDS:
            if field_name in club and not isinstance(club[field_name], str):
                reasons.append(
                    f"{label} club {index} field {field_name} must be a string"
                )
    return reasons


def validate_clubs(
    candidate: dict[str, Any], previous: dict[str, Any]
) -> ValidationResult:
    candidate_clubs = candidate.get("clubs")
    previous_clubs = previous.get("clubs")
    candidate_season = _parse_season(candidate.get("season"))
    effective_season = candidate_season or _previous_season(previous)
    metrics = {
        "clubs": len(candidate_clubs) if isinstance(candidate_clubs, list) else 0
    }
    reasons: list[str] = []

    if not isinstance(previous_clubs, list):
        reasons.append("Malformed previous clubs structure")
    else:
        reasons.extend(_club_record_issues(previous_clubs, "Previous"))

    if not isinstance(candidate_clubs, list):
        reasons.append("Malformed clubs structure")
    else:
        reasons.extend(_club_record_issues(candidate_clubs, "Candidate"))

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


def _canonical_archive_seasons(
    seasons: set[Any], label: str
) -> tuple[set[str], list[str]]:
    canonical_seasons: set[str] = set()
    reasons: list[str] = []
    for season in sorted(seasons, key=repr):
        if isinstance(season, str) and not season.strip():
            reasons.append(f"Blank {label.lower()} archive season identifier")
            continue
        canonical_season = _parse_archive_season(season)
        if canonical_season is None:
            reasons.append(f"Invalid {label.lower()} archive season identifier: {season!r}")
            continue
        if canonical_season in canonical_seasons:
            reasons.append(
                f"Duplicate normalized {label.lower()} archive season: {canonical_season}"
            )
        canonical_seasons.add(canonical_season)
    return canonical_seasons, reasons


def _parse_archive_season(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    short = re.fullmatch(r"(\d{2})/(\d{2})", normalized)
    if short is not None:
        start_short, end_short = (int(part) for part in short.groups())
        start_year = 2000 + start_short
        end_year = 2000 + end_short
        if end_year > start_year:
            return f"{start_year}/{end_short:02d}"
        return None

    long = re.fullmatch(r"(\d{4})[/-](\d{2}|\d{4})", normalized)
    if long is None:
        return None
    start_year = int(long.group(1))
    raw_end = long.group(2)
    end_year = int(raw_end) if len(raw_end) == 4 else start_year // 100 * 100 + int(raw_end)
    if end_year <= start_year:
        return None
    return f"{start_year}/{end_year % 100:02d}"


def validate_archives(
    candidate_seasons: Any, previous_seasons: Any
) -> ValidationResult:
    if not isinstance(candidate_seasons, set) or not isinstance(
        previous_seasons, set
    ):
        return ValidationResult(
            domain="archives",
            decision=Decision.BLOCKED,
            effective_season="unknown",
            reasons=("Archive season containers must be sets",),
            metrics={"candidate_seasons": 0, "previous_seasons": 0},
        )

    metrics = {
        "candidate_seasons": len(candidate_seasons),
        "previous_seasons": len(previous_seasons),
    }
    canonical_candidate, candidate_reasons = _canonical_archive_seasons(
        candidate_seasons, "Candidate"
    )
    canonical_previous, previous_reasons = _canonical_archive_seasons(
        previous_seasons, "Previous"
    )
    previous_effective = max(canonical_previous, default="unknown")
    reasons = candidate_reasons + previous_reasons
    if not previous_seasons:
        reasons.append("Previous archive baseline is empty")
    if reasons:
        return ValidationResult(
            domain="archives",
            decision=Decision.BLOCKED,
            effective_season=previous_effective,
            reasons=reasons,
            metrics=metrics,
        )

    missing = sorted(canonical_previous - canonical_candidate)
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
        effective_season=max(canonical_candidate, default="unknown"),
        metrics=metrics,
    )


def _archive_fingerprint(record: Any) -> str | None:
    if not isinstance(record, dict) or not _is_strict_json(record):
        return None
    try:
        return json.dumps(
            record,
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    except (TypeError, ValueError):
        return None


def _archive_rows_fingerprint(rows: Any) -> str | None:
    if not isinstance(rows, list) or not _is_strict_json(rows):
        return None
    try:
        return json.dumps(
            rows,
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    except (TypeError, ValueError):
        return None


def _archive_table_identity(season: Any, league: Any) -> tuple[str, str] | None:
    canonical_season = _parse_archive_season(season)
    if canonical_season is None or not isinstance(league, str) or not league.strip():
        return None
    title = unicodedata.normalize("NFKC", league).casefold()

    def remove_matching_season(match: re.Match[str]) -> str:
        normalized = re.sub(r"\s*[/_.-]\s*", "/", match.group())
        if _parse_archive_season(normalized) == canonical_season:
            return " "
        return match.group()

    title = re.sub(
        r"(?<!\d)(?:\d{4}|\d{2})\s*[/_.-]\s*(?:\d{4}|\d{2})(?!\d)",
        remove_matching_season,
        title,
    )
    title = re.sub(r"[_/-]+", " ", title)
    title = re.sub(r"\bbwedl\s*e\.?\s*v\.?", " ", title)
    title = re.sub(r"\bam\s+\d{1,2}\.\d{1,2}\.\d{4}\b", " ", title)
    title = re.sub(
        r"\b(?:mm|mannschafts?meisterschaft(?:en)?|meisterschaft(?:en)?)\b",
        " ",
        title,
    )
    title = re.sub(r"[_\W]+", " ", title, flags=re.UNICODE)
    title = re.sub(r"\s+", " ", title).strip()
    return canonical_season, title


def _archive_title_has_structural_partition(identity: tuple[str, str]) -> bool:
    return re.search(
        r"\b(?:gruppe|runde|spieltag|achtelfinale|viertelfinale|halbfinale|finale)\b",
        identity[1],
    ) is not None


def _is_strict_json(value: Any) -> bool:
    if value is None or isinstance(value, (str, bool, int)):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        return all(_is_strict_json(item) for item in value)
    if isinstance(value, dict):
        return all(
            isinstance(key, str) and _is_strict_json(item)
            for key, item in value.items()
        )
    return False


def validate_archive_payloads(
    candidate_data: Any,
    previous_data: Any,
    candidate_tables: Any,
    previous_tables: Any,
) -> ValidationResult:
    reasons: list[str] = []
    candidate_seasons: set[Any] = set()
    previous_seasons: set[Any] = set()

    def inspect_data(payload: Any, label: str, seasons: set[Any]) -> dict[str, set[str]]:
        fingerprints: dict[str, set[str]] = {}
        if not isinstance(payload, dict) or not payload:
            reasons.append(f"{label} archive player data must be a nonempty object")
            return fingerprints
        for player_key, history in payload.items():
            if not isinstance(player_key, str) or not player_key.strip():
                reasons.append(f"{label} archive player key must be nonblank")
                continue
            if not isinstance(history, list) or not history:
                reasons.append(f"{label} archive player history must be a nonempty list")
                continue
            seen: set[str] = set()
            for record in history:
                fingerprint = _archive_fingerprint(record)
                if fingerprint is None:
                    reasons.append(f"{label} archive history record is not strict JSON object")
                    continue
                season = record.get("season")
                league = record.get("league")
                canonical_season = _parse_archive_season(season)
                if canonical_season is None:
                    reasons.append(f"{label} archive history record has invalid season")
                else:
                    seasons.add(canonical_season)
                if not isinstance(league, str) or not league.strip():
                    reasons.append(f"{label} archive history record has blank league")
                if fingerprint in seen:
                    reasons.append(f"{label} archive history has duplicate record")
                seen.add(fingerprint)
            fingerprints[player_key] = seen
        return fingerprints

    def inspect_tables(
        payload: Any, label: str, seasons: set[Any]
    ) -> tuple[set[str], list[_ArchiveTableRecord]]:
        fingerprints: set[str] = set()
        records: list[_ArchiveTableRecord] = []
        if not isinstance(payload, list) or not payload:
            reasons.append(f"{label} archive tables must be a nonempty list")
            return fingerprints, records
        for record in payload:
            fingerprint = _archive_fingerprint(record)
            if fingerprint is None:
                reasons.append(f"{label} archive table record is not strict JSON object")
                continue
            season = record.get("season")
            league = record.get("league")
            rows = record.get("rows")
            canonical_season = _parse_archive_season(season)
            if canonical_season is None:
                reasons.append(f"{label} archive table has invalid season")
            else:
                seasons.add(canonical_season)
            if not isinstance(league, str) or not league.strip():
                reasons.append(f"{label} archive table has blank league")
            if not isinstance(rows, list):
                reasons.append(f"{label} archive table rows must be a list")
            if fingerprint in fingerprints:
                reasons.append(f"{label} archive tables have duplicate record")
            fingerprints.add(fingerprint)
            identity = _archive_table_identity(season, league)
            rows_fingerprint = _archive_rows_fingerprint(rows)
            if (
                identity is not None
                and canonical_season is not None
                and rows_fingerprint is not None
            ):
                records.append(
                    _ArchiveTableRecord(
                        canonical_season=canonical_season,
                        canonical_title_identity=identity,
                        row_count=len(rows),
                        rows_fingerprint=rows_fingerprint,
                        label=f"{canonical_season} {league.strip()}",
                    )
                )
        return fingerprints, records

    candidate_players = inspect_data(candidate_data, "Candidate", candidate_seasons)
    previous_players = inspect_data(previous_data, "Previous", previous_seasons)
    candidate_table_fingerprints, candidate_table_records = inspect_tables(
        candidate_tables, "Candidate", candidate_seasons
    )
    previous_table_fingerprints, previous_table_records = inspect_tables(
        previous_tables, "Previous", previous_seasons
    )

    for player_key, previous_records in previous_players.items():
        if player_key not in candidate_players:
            reasons.append(f"Candidate archive is missing previous player: {player_key}")
            continue
        missing_records = previous_records - candidate_players[player_key]
        if missing_records:
            reasons.append(f"Candidate archive player {player_key} lost {len(missing_records)} record(s)")
    unmatched_previous = set(range(len(previous_table_records)))
    unmatched_candidate = set(range(len(candidate_table_records)))
    candidate_exact_matches: dict[tuple[str, str], list[int]] = {}
    for candidate_index, record in enumerate(candidate_table_records):
        key = (record.canonical_season, record.rows_fingerprint)
        candidate_exact_matches.setdefault(key, []).append(candidate_index)

    for previous_index, previous_record in enumerate(previous_table_records):
        key = (previous_record.canonical_season, previous_record.rows_fingerprint)
        available = [
            candidate_index
            for candidate_index in candidate_exact_matches.get(key, [])
            if candidate_index in unmatched_candidate
            and (
                candidate_table_records[candidate_index].canonical_title_identity
                == previous_record.canonical_title_identity
                or (
                    not _archive_title_has_structural_partition(
                        previous_record.canonical_title_identity
                    )
                    and not _archive_title_has_structural_partition(
                        candidate_table_records[
                            candidate_index
                        ].canonical_title_identity
                    )
                )
            )
        ]
        if not available:
            continue
        candidate_index = next(
            (
                index
                for index in available
                if candidate_table_records[index].canonical_title_identity
                == previous_record.canonical_title_identity
            ),
            available[0],
        )
        unmatched_previous.remove(previous_index)
        unmatched_candidate.remove(candidate_index)

    previous_counts: dict[tuple[str, str], list[int]] = {}
    previous_labels: dict[tuple[str, str], str] = {}
    for previous_index in unmatched_previous:
        record = previous_table_records[previous_index]
        previous_counts.setdefault(record.canonical_title_identity, []).append(
            record.row_count
        )
        previous_labels.setdefault(record.canonical_title_identity, record.label)

    candidate_counts: dict[tuple[str, str], list[int]] = {}
    for candidate_index in unmatched_candidate:
        record = candidate_table_records[candidate_index]
        candidate_counts.setdefault(record.canonical_title_identity, []).append(
            record.row_count
        )

    for identity, previous_row_counts in previous_counts.items():
        candidate_row_counts = candidate_counts.get(identity, [])
        label = previous_labels[identity]
        if len(candidate_row_counts) < len(previous_row_counts):
            reasons.append(f"Candidate archive table count loss for {label}")
            continue
        candidate_sorted = sorted(candidate_row_counts, reverse=True)
        previous_sorted = sorted(previous_row_counts, reverse=True)
        if any(
            candidate < previous
            for candidate, previous in zip(candidate_sorted, previous_sorted)
        ):
            reasons.append(f"Candidate archive table row count loss for {label}")

    season_result = validate_archives(candidate_seasons, previous_seasons)
    reasons.extend(season_result.reasons)
    metrics = {
        "candidate_players": len(candidate_players),
        "previous_players": len(previous_players),
        "candidate_records": sum(len(items) for items in candidate_players.values()),
        "previous_records": sum(len(items) for items in previous_players.values()),
        "candidate_tables": len(candidate_table_fingerprints),
        "previous_tables": len(previous_table_fingerprints),
        "candidate_seasons": len(candidate_seasons),
        "previous_seasons": len(previous_seasons),
    }
    return ValidationResult(
        "archives",
        Decision.BLOCKED if reasons else Decision.PUBLISH,
        season_result.effective_season,
        tuple(reasons),
        metrics,
    )


def _reject_json_constant(constant: str) -> Any:
    raise ValueError(f"Non-JSON constant: {constant}")


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
        return json.loads(
            assignment.group(1), parse_constant=_reject_json_constant
        )
    except (json.JSONDecodeError, ValueError) as error:
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
    try:
        canonical_json = json.dumps(
            json_payload,
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    except (TypeError, ValueError):
        return False, "JSON payload is not valid canonical JSON"
    try:
        canonical_javascript = json.dumps(
            javascript_payload,
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    except (TypeError, ValueError):
        return False, "JavaScript payload is not valid canonical JSON"
    if canonical_javascript != canonical_json:
        return False, "JSON and JavaScript payloads differ"
    return True, ""
