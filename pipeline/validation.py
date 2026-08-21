from __future__ import annotations

import json
import math
import re
import unicodedata
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Any

from bs4 import BeautifulSoup

from pipeline.archive_players import ArchivePlayerParseError, merge_archive_entries
from pipeline.html_sanitizer import safe_table_fragment_issue


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


@dataclass(frozen=True)
class _ArchiveSegmentRecord:
    record: Mapping[str, Any]
    fingerprint: str
    segment_id: str | None
    legacy_signature: tuple[Any, ...] | None
    has_preview_evidence: bool
    valid_preview_evidence: bool
    administrative_markers: int


@dataclass(frozen=True)
class _ArchivePlayerRecord:
    record: Mapping[str, Any]
    fingerprint: str
    identity: str | None
    identity_with_v_nr: str | None
    has_v_nr: bool
    has_preview_evidence: bool
    valid_preview_evidence: bool
    is_v2: bool
    segments: tuple[_ArchiveSegmentRecord, ...]
    identity_ambiguous: bool
    round_overlap_ambiguous: bool
    unknown_fields: tuple[str, ...]


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
MAX_JAVASCRIPT_SAFE_INTEGER = 2**53 - 1
ARCHIVE_PREVIEW_FIELDS = frozenset(
    {"rounds", "appearances", "points_per_appearance"}
)
ARCHIVE_ADMIN_ROUND_MARKERS = frozenset({"x", "vw", "d", "kp", "*"})
ARCHIVE_AFFILIATION_MARKERS = frozenset({"vw"})
ARCHIVE_LEGACY_FIELDS = frozenset({
    "id", "season", "league", "rank", "name", "points", "v_nr",
    "rounds", "appearances", "points_per_appearance",
})
ARCHIVE_V2_CONTAINER_FIELDS = frozenset({
    "season", "league", "rank", "name", "points", "primary_segment_id",
    "segments", "v_nr", "rounds", "appearances", "points_per_appearance",
    "identity_ambiguous", "round_overlap_ambiguous",
})
ARCHIVE_V2_SEGMENT_FIELDS = frozenset({
    "segment_id", "league", "rank", "name", "points", "v_nr",
    "affiliation_marker", "rounds", "appearances", "points_per_appearance",
})
APPROVED_ARCHIVE_LEGACY_REMOVALS = frozenset({
    (
        "10",
        '{"league":"C-Klasse","name":"Matteo P.","points":216,'
        '"rank":1,"season":"24/25"}',
    ),
    (
        "14",
        '{"league":"C-Klasse","name":"x","points":127,'
        '"rank":7,"season":"24/25"}',
    ),
})


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
    unsafe_ranking_tables = 0
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
        if safe_table_fragment_issue(table) is not None:
            unsafe_ranking_tables += 1
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
    if unsafe_ranking_tables:
        metrics["unsafe_ranking_tables"] = unsafe_ranking_tables
        reasons.append(f"Unsafe ranking tables: {unsafe_ranking_tables}")

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
    if safe_table_fragment_issue(table) is not None:
        return "unsafe table"

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
    match = re.fullmatch(
        r"([0-9]{2}|[0-9]{4})[/-]([0-9]{2}|[0-9]{4})", normalized
    )
    if match is None:
        return None
    raw_start, raw_end = match.groups()
    start_year = int(raw_start)
    if len(raw_start) == 2:
        start_year += 1900 if start_year >= 70 else 2000
    end_year = int(raw_end)
    if len(raw_end) == 2:
        end_year += (start_year // 100) * 100
        if end_year < start_year:
            end_year += 100
    if end_year - start_year not in {1, 2}:
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


def _archive_player_identity(
    player_key: str, record: Mapping[str, Any], *, include_v_nr: bool = False
) -> str | None:
    """Return an exact core identity, using the archive key as the stored ID."""

    core_fields = ("season", "league", "rank", "name", "points")
    if any(field not in record for field in core_fields):
        return None
    player_id = record.get("id", player_key)
    identity: dict[str, Any] = {
        "season": record["season"],
        "league": record["league"],
        "rank": record["rank"],
        "id": player_id,
        "name": record["name"],
        "points": record["points"],
    }
    if include_v_nr:
        if "v_nr" not in record:
            return None
        identity["v_nr"] = record["v_nr"]
    return _archive_fingerprint(identity)


def _is_safe_nonnegative_integer(value: Any) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= MAX_JAVASCRIPT_SAFE_INTEGER
    )


def _is_finite_nonnegative_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return 0 <= value <= MAX_JAVASCRIPT_SAFE_INTEGER
    return isinstance(value, float) and math.isfinite(value) and value >= 0


def _archive_record_is_preserved(
    previous: Mapping[str, Any], candidate: Mapping[str, Any]
) -> bool:
    if any(key not in candidate for key in previous):
        return False
    projection = {key: candidate[key] for key in previous}
    return _archive_fingerprint(projection) == _archive_fingerprint(dict(previous))


def _validate_archive_player_core(
    player_key: str, record: Mapping[str, Any]
) -> tuple[str, ...]:
    issues: list[str] = []
    if re.fullmatch(r"[0-9]+", player_key) is None:
        issues.append("archive player id must contain ASCII digits")

    if "id" in record:
        player_id = record["id"]
        if (
            not isinstance(player_id, str)
            or re.fullmatch(r"[0-9]+", player_id) is None
            or player_id != player_key
        ):
            issues.append("archive player id must contain ASCII digits and match its key")

    if _parse_archive_season(record.get("season")) is None:
        issues.append("archive season must be canonical and use ASCII digits")
    for field in ("league", "name"):
        value = record.get(field)
        if not isinstance(value, str) or not value.strip():
            issues.append(f"archive {field} must be nonblank")

    for field in ("rank", "points"):
        if not _is_safe_nonnegative_integer(record.get(field)):
            issues.append(
                f"archive {field} must be a nonnegative JavaScript safe integer"
            )

    if "v_nr" in record:
        club_number = record["v_nr"]
        if (
            not isinstance(club_number, str)
            or re.fullmatch(r"[0-9]+", club_number) is None
        ):
            issues.append("archive club number must contain ASCII digits")
    if "affiliation_marker" in record:
        marker = record["affiliation_marker"]
        normalized_marker = (
            unicodedata.normalize("NFKC", marker).strip()
            if isinstance(marker, str) else None
        )
        if (
            normalized_marker is None
            or marker != normalized_marker
            or not marker
            or marker.casefold() not in ARCHIVE_AFFILIATION_MARKERS
        ):
            issues.append(
                "archive affiliation marker must be normalized and allowed"
            )
    if "v_nr" in record and "affiliation_marker" in record:
        issues.append(
            "archive club number and affiliation marker are mutually exclusive"
        )
    return tuple(issues)


def _validate_archive_preview_evidence(
    player_key: str, record: Mapping[str, Any], *, require_affiliation: bool = True
) -> tuple[bool, tuple[str, ...]]:
    """Validate optional round evidence without making totals-only history unusable."""

    present_fields = ARCHIVE_PREVIEW_FIELDS.intersection(record)
    if not present_fields:
        return False, ()
    if present_fields != ARCHIVE_PREVIEW_FIELDS:
        return False, ("preview evidence fields must be all-or-none",)

    issues: list[str] = []
    points = record.get("points")
    valid_points = _is_safe_nonnegative_integer(points)

    if (
        require_affiliation
        and "v_nr" not in record
        and "affiliation_marker" not in record
    ):
        issues.append("preview club number or affiliation marker is required")

    rounds = record.get("rounds")
    numeric_rounds: list[int | float] = []
    if not isinstance(rounds, Mapping):
        issues.append("preview rounds must be a mapping")
    elif not rounds:
        issues.append("preview rounds must be nonempty")
    else:
        round_numbers: list[int] = []
        for key, value in sorted(rounds.items(), key=lambda item: repr(item[0])):
            match = re.fullmatch(r"R([1-9][0-9]?)", key) if isinstance(key, str) else None
            if match is None:
                issues.append(f"preview round key is invalid: {key!r}")
            else:
                round_numbers.append(int(match.group(1)))
            if _is_safe_nonnegative_integer(value):
                numeric_rounds.append(value)
            elif isinstance(value, str):
                normalized_marker = unicodedata.normalize("NFKC", value).strip()
                if (
                    value != normalized_marker
                    or (
                        normalized_marker
                        and normalized_marker.casefold()
                        not in ARCHIVE_ADMIN_ROUND_MARKERS
                    )
                ):
                    issues.append(
                        f"preview round value must be a normalized allowed marker "
                        f"or nonnegative JavaScript safe integer for {key!r}"
                    )
            else:
                issues.append(
                    f"preview round value must be a marker or nonnegative "
                    f"JavaScript safe integer for {key!r}"
                )
        if round_numbers and sorted(round_numbers) != list(
            range(1, max(round_numbers) + 1)
        ):
            issues.append("preview round keys must be a contiguous sequence from R1")

    appearances = record.get("appearances")
    valid_appearances = _is_safe_nonnegative_integer(appearances)
    if not valid_appearances:
        issues.append(
            "preview appearances must be a nonnegative JavaScript safe integer"
        )
    elif appearances != len(numeric_rounds):
        issues.append("preview appearances do not match numeric round values")

    if valid_points and sum(numeric_rounds) != points:
        issues.append("preview round sum does not match points")

    average = record.get("points_per_appearance")
    if not _is_finite_nonnegative_number(average):
        issues.append("preview points per appearance must be a finite nonnegative number")
    elif valid_points and valid_appearances:
        expected_average = points / appearances if appearances else 0.0
        if not math.isclose(
            average, expected_average, rel_tol=0.0, abs_tol=1e-12
        ):
            issues.append("preview points per appearance does not match points/appearances")

    return True, tuple(issues)


def _normalized_archive_identity_text(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _archive_legacy_signature(
    player_key: str, record: Mapping[str, Any]
) -> tuple[Any, ...] | None:
    season = _parse_archive_season(record.get("season"))
    name = _normalized_archive_identity_text(record.get("name"))
    league = _normalized_archive_identity_text(record.get("league"))
    rank = record.get("rank")
    points = record.get("points")
    if (
        season is None
        or name is None
        or league is None
        or not _is_safe_nonnegative_integer(rank)
        or not _is_safe_nonnegative_integer(points)
    ):
        return None
    return (player_key, season, name, league, rank, points)


def _archive_marker_count(record: Mapping[str, Any]) -> int:
    rounds = record.get("rounds")
    if not isinstance(rounds, Mapping):
        return 0
    return sum(
        1 for value in rounds.values()
        if isinstance(value, str) and bool(value)
    )


def _archive_segments(
    record: Mapping[str, Any], player_key: str
) -> tuple[bool, tuple[_ArchiveSegmentRecord, ...], tuple[str, ...]]:
    """Return validated legacy virtual segments or strict v2 source segments."""

    v2_keys = {
        "segments", "primary_segment_id", "identity_ambiguous",
        "round_overlap_ambiguous",
    }
    is_v2 = bool(v2_keys.intersection(record))
    if not is_v2:
        fingerprint = _archive_fingerprint(dict(record))
        has_preview, preview_issues = _validate_archive_preview_evidence(
            player_key, record
        )
        if fingerprint is None:
            return False, (), ("legacy archive segment is not strict JSON",)
        return False, (
            _ArchiveSegmentRecord(
                record=record,
                fingerprint=fingerprint,
                segment_id=None,
                legacy_signature=_archive_legacy_signature(player_key, record),
                has_preview_evidence=has_preview,
                valid_preview_evidence=has_preview and not preview_issues,
                administrative_markers=_archive_marker_count(record),
            ),
        ), ()

    issues: list[str] = []
    unknown_container_fields = sorted(
        set(record).difference(ARCHIVE_V2_CONTAINER_FIELDS)
    )
    if unknown_container_fields:
        issues.append(
            "v2 container schema drift: unknown fields "
            + ", ".join(unknown_container_fields)
        )
    raw_segments = record.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        return True, (), ("v2 segments must be a nonempty list",)

    segments: list[_ArchiveSegmentRecord] = []
    source_records: list[dict[str, Any]] = []
    seen_segment_ids: set[str] = set()
    for index, raw_segment in enumerate(raw_segments):
        fingerprint = _archive_fingerprint(raw_segment)
        if fingerprint is None:
            issues.append(f"v2 segment {index} is not a strict JSON object")
            continue
        segment_id = raw_segment.get("segment_id")
        if (
            not isinstance(segment_id, str)
            or re.fullmatch(r"sha256:[0-9a-f]{64}", segment_id) is None
        ):
            issues.append(f"v2 segment {index} has invalid segment id")
            normalized_segment_id = None
        else:
            normalized_segment_id = segment_id
            if segment_id in seen_segment_ids:
                issues.append("v2 segment identity collision")
            seen_segment_ids.add(segment_id)

        semantic = {
            key: value for key, value in raw_segment.items()
            if key != "segment_id"
        }
        unknown_segment_fields = sorted(
            set(raw_segment).difference(ARCHIVE_V2_SEGMENT_FIELDS)
        )
        if unknown_segment_fields:
            issues.append(
                f"v2 segment {index} schema drift: unknown fields "
                + ", ".join(unknown_segment_fields)
            )
        prohibited = {
            "id", "season", "segments", "primary_segment_id",
            "identity_ambiguous", "round_overlap_ambiguous",
        }.intersection(semantic)
        if prohibited:
            issues.append(
                f"v2 segment {index} contains derived identity fields"
            )
        virtual_record = {
            **semantic,
            "season": record.get("season"),
        }
        core_issues = _validate_archive_player_core(player_key, virtual_record)
        has_preview, preview_issues = _validate_archive_preview_evidence(
            player_key, virtual_record
        )
        issues.extend(f"v2 segment {index}: {issue}" for issue in core_issues)
        issues.extend(f"v2 segment {index}: {issue}" for issue in preview_issues)
        segments.append(
            _ArchiveSegmentRecord(
                record=virtual_record,
                fingerprint=fingerprint,
                segment_id=normalized_segment_id,
                legacy_signature=_archive_legacy_signature(
                    player_key, virtual_record
                ),
                has_preview_evidence=has_preview,
                valid_preview_evidence=(
                    has_preview and not core_issues and not preview_issues
                ),
                administrative_markers=_archive_marker_count(virtual_record),
            )
        )
        source_records.append({
            **semantic,
            "id": player_key,
            "season": record.get("season"),
        })

    if len(source_records) == len(raw_segments):
        try:
            recomputed = merge_archive_entries(source_records)[player_key][0]
        except (ArchivePlayerParseError, KeyError, TypeError, ValueError) as error:
            issues.append(f"v2 segment aggregate is invalid: {error}")
        else:
            if _archive_fingerprint(recomputed) != _archive_fingerprint(dict(record)):
                issues.append(
                    "v2 container does not match recomputed segment ids, order, "
                    "safe aggregates, flags, or derived fields"
                )
    return True, tuple(segments), tuple(issues)


def _legacy_record_matches_v2_segment(
    player_key: str,
    previous: Mapping[str, Any],
    candidate: _ArchiveSegmentRecord,
) -> bool:
    if (
        candidate.legacy_signature is None
        or candidate.legacy_signature
        != _archive_legacy_signature(player_key, previous)
    ):
        return False
    core = {"id", "season", "league", "rank", "name", "points"}
    previous_extra = {
        key: value for key, value in previous.items() if key not in core
    }
    candidate_extra = {
        key: candidate.record[key]
        for key in previous_extra
        if key in candidate.record
    }
    return (
        len(candidate_extra) == len(previous_extra)
        and _archive_fingerprint(previous_extra)
        == _archive_fingerprint(candidate_extra)
    )


def _legacy_unknown_fields_are_grandfathered(
    player_key: str,
    candidate: _ArchivePlayerRecord,
    previous_records: list[_ArchivePlayerRecord],
) -> bool:
    if candidate.is_v2 or not candidate.unknown_fields:
        return True
    candidate_signature = _archive_legacy_signature(
        player_key, candidate.record
    )
    if candidate_signature is None:
        return False
    matches = []
    for previous in previous_records:
        if (
            previous.is_v2
            or _archive_legacy_signature(player_key, previous.record)
            != candidate_signature
        ):
            continue
        previous_projection = {
            field: previous.record[field]
            for field in candidate.unknown_fields
            if field in previous.record
        }
        candidate_projection = {
            field: candidate.record[field] for field in candidate.unknown_fields
        }
        if (
            len(previous_projection) == len(candidate_projection)
            and _archive_fingerprint(previous_projection)
            == _archive_fingerprint(candidate_projection)
        ):
            matches.append(previous)
    return len(matches) == 1


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


def _archive_competition_family(identity: tuple[str, str]) -> str | None:
    title = identity[1]
    class_match = re.search(r"\b([abc])\s+klassen?\b", title)
    if class_match is not None:
        return f"{class_match.group(1)}-klasse"

    named_families = (
        ("bundesliga", r"\bbundesliga\b"),
        ("verbandsliga", r"\bverbandsliga\b"),
        ("oberliga", r"\boberliga\b"),
        ("bezirksliga", r"\bbezirksliga\b"),
        ("ligapokal", r"\b(?:ligapokal|liga\s+pokal)\b"),
        ("pokal", r"\bpokal\b"),
    )
    for family, pattern in named_families:
        if re.search(pattern, title) is not None:
            return family
    return None


def _archive_title_has_structural_partition(identity: tuple[str, str]) -> bool:
    return re.search(
        r"\b(?:gruppe|gruppen(?:\s+)?(?:phase|runde)|runde|"
        r"(?:vor|zwischen|haupt|end|final)(?:\s+)?runde|spieltag|"
        r"(?:achtel|viertel|halb)(?:\s+)?finale?|finale?)\b",
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

    def inspect_data(
        payload: Any, label: str, seasons: set[Any]
    ) -> dict[str, list[_ArchivePlayerRecord]]:
        players: dict[str, list[_ArchivePlayerRecord]] = {}
        if not isinstance(payload, dict) or not payload:
            reasons.append(f"{label} archive player data must be a nonempty object")
            return players
        for player_key, history in sorted(
            payload.items(), key=lambda item: repr(item[0])
        ):
            if not isinstance(player_key, str) or not player_key.strip():
                reasons.append(f"{label} archive player key must be nonblank")
                continue
            if not isinstance(history, list) or not history:
                reasons.append(f"{label} archive player history must be a nonempty list")
                continue
            v2_seasons = [
                _parse_archive_season(record.get("season"))
                for record in history
                if isinstance(record, dict) and "segments" in record
            ]
            valid_v2_seasons = [season for season in v2_seasons if season is not None]
            if (
                len(valid_v2_seasons) > 1
                and valid_v2_seasons != sorted(valid_v2_seasons, reverse=True)
            ):
                reasons.append(
                    f"{label} archive player {player_key} v2 seasons must be newest-first"
                )
            seen: set[str] = set()
            seen_player_seasons: set[str] = set()
            inspected_records: list[_ArchivePlayerRecord] = []
            for record in sorted(
                history, key=lambda item: _archive_fingerprint(item) or repr(item)
            ):
                fingerprint = _archive_fingerprint(record)
                if fingerprint is None:
                    reasons.append(f"{label} archive history record is not strict JSON object")
                    continue
                is_v2, segments, segment_issues = _archive_segments(
                    record, player_key
                )
                core_issues = (
                    _validate_archive_player_core(player_key, record)
                    if label == "Candidate"
                    or is_v2
                    or bool(ARCHIVE_PREVIEW_FIELDS.intersection(record))
                    else ()
                )
                has_preview_evidence, preview_issues = (
                    _validate_archive_preview_evidence(
                        player_key, record, require_affiliation=not is_v2
                    )
                )
                reasons.extend(
                    f"{label} archive player {player_key}: {issue}"
                    for issue in (*core_issues, *preview_issues, *segment_issues)
                )
                season = record.get("season")
                league = record.get("league")
                canonical_season = _parse_archive_season(season)
                if canonical_season is None:
                    reasons.append(f"{label} archive history record has invalid season")
                else:
                    seasons.add(canonical_season)
                    if canonical_season in seen_player_seasons:
                        reasons.append(
                            f"{label} archive player {player_key} has duplicate season: "
                            f"{canonical_season}"
                        )
                    seen_player_seasons.add(canonical_season)
                if not isinstance(league, str) or not league.strip():
                    reasons.append(f"{label} archive history record has blank league")
                if fingerprint in seen:
                    reasons.append(f"{label} archive history has duplicate record")
                seen.add(fingerprint)
                inspected_records.append(
                    _ArchivePlayerRecord(
                        record=record,
                        fingerprint=fingerprint,
                        identity=_archive_player_identity(player_key, record),
                        identity_with_v_nr=_archive_player_identity(
                            player_key, record, include_v_nr=True
                        ),
                        has_v_nr="v_nr" in record,
                        has_preview_evidence=has_preview_evidence,
                        valid_preview_evidence=(
                            has_preview_evidence
                            and not core_issues
                            and not preview_issues
                        ),
                        is_v2=is_v2,
                        segments=segments,
                        identity_ambiguous=(
                            record.get("identity_ambiguous") is True
                        ),
                        round_overlap_ambiguous=(
                            record.get("round_overlap_ambiguous") is True
                        ),
                        unknown_fields=tuple(sorted(
                            set(record).difference(
                                ARCHIVE_V2_CONTAINER_FIELDS
                                if is_v2 else ARCHIVE_LEGACY_FIELDS
                            )
                        )),
                    )
                )
            players[player_key] = inspected_records
        return players

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

    for player_key, candidate_records in candidate_players.items():
        previous_records = previous_players.get(player_key, [])
        for candidate_record in candidate_records:
            if (
                candidate_record.unknown_fields
                and not _legacy_unknown_fields_are_grandfathered(
                    player_key, candidate_record, previous_records
                )
            ):
                reasons.append(
                    f"Candidate archive player {player_key} schema drift: "
                    "unknown legacy fields "
                    + ", ".join(candidate_record.unknown_fields)
                )

    approved_legacy_removals: set[tuple[str, str]] = set()
    for player_key, previous_records in previous_players.items():
        if player_key not in candidate_players:
            approved_for_player = {
                (player_key, record.fingerprint)
                for record in previous_records
                if not record.is_v2
                and (player_key, record.fingerprint)
                in APPROVED_ARCHIVE_LEGACY_REMOVALS
            }
            approved_legacy_removals.update(approved_for_player)
            if len(approved_for_player) != len(previous_records):
                reasons.append(
                    f"Candidate archive is missing previous player: {player_key}"
                )
            continue
        candidate_records = candidate_players[player_key]
        unmatched_candidates = set(range(len(candidate_records)))
        unmatched_previous: list[_ArchivePlayerRecord] = []
        for previous_record in previous_records:
            exact_matches = sorted(
                index
                for index in unmatched_candidates
                if candidate_records[index].fingerprint == previous_record.fingerprint
            )
            if exact_matches:
                unmatched_candidates.remove(exact_matches[0])
            else:
                unmatched_previous.append(previous_record)

        lost_records = 0
        consumed_v2_segments: set[tuple[int, int]] = set()
        for previous_record in unmatched_previous:
            if previous_record.is_v2:
                candidate_by_id: dict[str, list[_ArchiveSegmentRecord]] = {}
                for candidate_record in candidate_records:
                    if not candidate_record.is_v2:
                        continue
                    for segment in candidate_record.segments:
                        if segment.segment_id is not None:
                            candidate_by_id.setdefault(segment.segment_id, []).append(
                                segment
                            )
                for previous_segment in previous_record.segments:
                    segment_id = previous_segment.segment_id
                    matches = candidate_by_id.get(segment_id or "", [])
                    if not any(
                        candidate_segment.fingerprint
                        == previous_segment.fingerprint
                        for candidate_segment in matches
                    ):
                        reasons.append(
                            f"Candidate archive player {player_key} lost or rewrote "
                            f"published segment {segment_id or 'invalid'}"
                        )
                continue

            expected_identity = (
                previous_record.identity_with_v_nr
                if previous_record.has_v_nr
                else previous_record.identity
            )
            flat_matches = sorted(
                index
                for index in unmatched_candidates
                if not candidate_records[index].is_v2
                and candidate_records[index].valid_preview_evidence
                and _archive_record_is_preserved(
                    previous_record.record, candidate_records[index].record
                )
                and (
                    candidate_records[index].identity_with_v_nr
                    if previous_record.has_v_nr
                    else candidate_records[index].identity
                )
                == expected_identity
            )
            v2_matches = sorted(
                (candidate_index, segment_index)
                for candidate_index, candidate_record in enumerate(candidate_records)
                if candidate_record.is_v2
                for segment_index, segment in enumerate(candidate_record.segments)
                if (candidate_index, segment_index) not in consumed_v2_segments
                and _legacy_record_matches_v2_segment(
                    player_key, previous_record.record, segment
                )
            )
            match_count = len(flat_matches) + len(v2_matches)
            if match_count == 1:
                if flat_matches:
                    unmatched_candidates.remove(flat_matches[0])
                else:
                    consumed_v2_segments.add(v2_matches[0])
            elif match_count > 1:
                reasons.append(
                    f"Candidate archive player {player_key} has ambiguous legacy enrichment"
                )
            elif (
                player_key, previous_record.fingerprint
            ) in APPROVED_ARCHIVE_LEGACY_REMOVALS:
                approved_legacy_removals.add(
                    (player_key, previous_record.fingerprint)
                )
            else:
                lost_records += 1
        if lost_records:
            reasons.append(
                f"Candidate archive player {player_key} lost {lost_records} record(s)"
            )
    unmatched_previous = set(range(len(previous_table_records)))
    unmatched_candidate = set(range(len(candidate_table_records)))
    candidate_exact_matches: dict[tuple[str, str], list[int]] = {}
    for candidate_index, record in enumerate(candidate_table_records):
        key = (record.canonical_season, record.rows_fingerprint)
        candidate_exact_matches.setdefault(key, []).append(candidate_index)

    def table_match_sort_key(
        record: _ArchiveTableRecord,
    ) -> tuple[str, str, tuple[str, str], str]:
        return (
            record.canonical_season,
            record.rows_fingerprint,
            record.canonical_title_identity,
            record.label,
        )

    def consume_exact_matches(
        is_eligible: Callable[[_ArchiveTableRecord, _ArchiveTableRecord], bool],
    ) -> None:
        previous_order = sorted(
            unmatched_previous,
            key=lambda index: table_match_sort_key(previous_table_records[index]),
        )
        for previous_index in previous_order:
            previous_record = previous_table_records[previous_index]
            key = (previous_record.canonical_season, previous_record.rows_fingerprint)
            available = sorted(
                (
                    candidate_index
                    for candidate_index in candidate_exact_matches.get(key, [])
                    if candidate_index in unmatched_candidate
                    and is_eligible(
                        previous_record, candidate_table_records[candidate_index]
                    )
                ),
                key=lambda index: table_match_sort_key(candidate_table_records[index]),
            )
            if not available:
                continue
            unmatched_previous.remove(previous_index)
            unmatched_candidate.remove(available[0])

    def has_same_identity(
        previous_record: _ArchiveTableRecord, candidate_record: _ArchiveTableRecord
    ) -> bool:
        return (
            previous_record.canonical_title_identity
            == candidate_record.canonical_title_identity
        )

    def has_same_explicit_family(
        previous_record: _ArchiveTableRecord, candidate_record: _ArchiveTableRecord
    ) -> bool:
        previous_family = _archive_competition_family(
            previous_record.canonical_title_identity
        )
        return (
            previous_record.canonical_title_identity
            != candidate_record.canonical_title_identity
            and previous_family is not None
            and previous_family
            == _archive_competition_family(candidate_record.canonical_title_identity)
            and not _archive_title_has_structural_partition(
                previous_record.canonical_title_identity
            )
            and not _archive_title_has_structural_partition(
                candidate_record.canonical_title_identity
            )
        )

    def migrates_legacy_unknown(
        previous_record: _ArchiveTableRecord, candidate_record: _ArchiveTableRecord
    ) -> bool:
        return (
            previous_record.canonical_title_identity[1] == "unbekannt"
            and _archive_competition_family(candidate_record.canonical_title_identity)
            is not None
            and not _archive_title_has_structural_partition(
                candidate_record.canonical_title_identity
            )
        )

    consume_exact_matches(has_same_identity)
    consume_exact_matches(has_same_explicit_family)
    consume_exact_matches(migrates_legacy_unknown)

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
    candidate_container_records = [
        record
        for player_records in candidate_players.values()
        for record in player_records
    ]
    candidate_segments = [
        segment
        for record in candidate_container_records
        for segment in record.segments
    ]
    preview_eligible_segments = sum(
        1
        for record in candidate_container_records
        if not record.identity_ambiguous and not record.round_overlap_ambiguous
        for segment in record.segments
        if segment.valid_preview_evidence
    )
    metrics = {
        "candidate_players": len(candidate_players),
        "previous_players": len(previous_players),
        "candidate_records": sum(len(items) for items in candidate_players.values()),
        "previous_records": sum(len(items) for items in previous_players.values()),
        "candidate_tables": len(candidate_table_fingerprints),
        "previous_tables": len(previous_table_fingerprints),
        "candidate_seasons": len(candidate_seasons),
        "previous_seasons": len(previous_seasons),
        "seasons": len(candidate_seasons),
        "containers": len(candidate_container_records),
        "segments": len(candidate_segments),
        "preview_eligible_segments": preview_eligible_segments,
        "totals_only_segments": sum(
            not segment.has_preview_evidence for segment in candidate_segments
        ),
        "administrative_markers": sum(
            segment.administrative_markers for segment in candidate_segments
        ),
        "identity_ambiguities": sum(
            record.identity_ambiguous for record in candidate_container_records
        ),
        "round_overlap_ambiguities": sum(
            record.round_overlap_ambiguous for record in candidate_container_records
        ),
        "approved_legacy_removals": len(approved_legacy_removals),
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


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON object key: {key!r}")
        result[key] = value
    return result


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
            assignment.group(1),
            parse_constant=_reject_json_constant,
            object_pairs_hook=_reject_duplicate_json_keys,
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
