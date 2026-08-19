"""Pure parsing helpers for regular BWEDL league fixtures.

The calendar generator consumes these value objects later; this module deliberately
does not read files or perform network I/O.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import re
import unicodedata
from typing import Any, Mapping
from zoneinfo import ZoneInfo


BERLIN = ZoneInfo("Europe/Berlin")
_LEGAL_FORM_SUFFIX = " e v"
_BYE_NAMES = {"spielfrei", "bye", "freilos", "freilose"}
_SEASON_RE = re.compile(r"(?P<season>\d{4}-\d{4})")
_DATE_PREFIX_RE = re.compile(
    r"^(?:\S+\.\s+)?(?P<day>\d{1,2})\.\s*(?P<month>\d{1,2})\."
    r"(?P<year>\d{2,4})(?:\s+(?P<hour>\d{1,2}):(?P<minute>\d{2}))?\s+"
    r"(?P<teams>.+?)\s*$"
)
_SCORE_SUFFIX_RE = re.compile(r"\s+(?:---|\d+\s*:\s*\d+|:)\s*$")
_TEAM_SEPARATOR_RE = re.compile(r"^(?P<home>.+?)\s+-\s+(?P<away>.+?)\s*$")

# These are source spelling variants observed in BWEDL's own club and fixture
# exports. They are a closed, explicit alias list; matching never guesses.
_KNOWN_CLUB_ALIASES = {
    "dc mephisto s": "DC Mephistos",
    "dc strikers": "DC Striker´s",
    "dc underground fools": "DC Underground Fool´s e.V.",
    "dc lightning arrows": "DC Lightning Arrows",
    "dc ligthning arrows": "DC Lightning Arrows",
    "heavy weights brotzingen": "Heavy Weigths Brötzingen",
    "alla haeeehr": "Alla Häeeeehr",
}


class CalendarSourceError(ValueError):
    """Raised when a source fixture cannot describe one unambiguous schedule."""


def normalize_team_name(value: str) -> str:
    """Return the JavaScript-compatible key used for exact team resolution."""
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    words = "".join(
        character.lower() if character.isalnum() else " "
        for character in without_marks
    )
    return " ".join(words.replace("ß", "ss").split())


@dataclass(frozen=True)
class Club:
    number: str
    name: str
    venue: str
    street: str
    city: str


@dataclass(frozen=True)
class TeamIdentity:
    name: str
    normalized_name: str
    team_id: str
    club_number: str | None = None
    club_name: str | None = None


@dataclass(frozen=True)
class HomeLocation:
    venue: str
    street: str
    city: str
    address: str
    incomplete: bool


@dataclass(frozen=True)
class LeagueGame:
    season: str
    league: str
    round_name: str
    home: TeamIdentity
    away: TeamIdentity
    starts_at_utc: datetime
    location: HomeLocation | None
    location_status: str


@dataclass(frozen=True)
class ClubCatalog:
    """An immutable, exact-match club index derived from raw club records."""

    clubs_by_number: Mapping[str, Club]
    clubs_by_alias: Mapping[str, tuple[Club, ...]]

    def resolve_team(self, team_name: str) -> TeamIdentity | None:
        normalized = normalize_team_name(team_name)
        candidates: list[tuple[Club, int]] = []
        for alias, clubs in self.clubs_by_alias.items():
            if normalized == alias:
                candidates.extend((club, 1) for club in clubs)
                continue
            prefix = f"{alias} "
            suffix = normalized.removeprefix(prefix)
            if normalized.startswith(prefix) and suffix.isdigit() and int(suffix) > 0:
                candidates.extend((club, int(suffix)) for club in clubs)

        distinct = {(club.number, slot): club for club, slot in candidates}
        if len(distinct) != 1:
            return None
        (number, slot), club = next(iter(distinct.items()))
        return TeamIdentity(
            name=team_name,
            normalized_name=normalized,
            team_id=f"club-{number}-team-{slot}",
            club_number=number,
            club_name=club.name,
        )

    def club_for(self, team: TeamIdentity) -> Club | None:
        return self.clubs_by_number.get(team.club_number or "")


def build_club_catalog(club_data: Mapping[str, Any]) -> ClubCatalog:
    """Build the strict club/alias index from a decoded ``club_data.json`` object."""
    clubs_by_number: dict[str, Club] = {}
    aliases: dict[str, list[Club]] = {}

    for record in club_data.get("clubs", []):
        number = _source_text(record.get("number"))
        name = _source_text(record.get("name"))
        if not number or not name:
            continue
        club = Club(
            number=number,
            name=name,
            venue=_source_text(record.get("venue")),
            street=_source_text(record.get("street")),
            city=_source_text(record.get("city")),
        )
        clubs_by_number[number] = club
        for alias in _club_aliases(club):
            aliases.setdefault(alias, []).append(club)

    return ClubCatalog(
        clubs_by_number=clubs_by_number,
        clubs_by_alias={alias: tuple(clubs) for alias, clubs in aliases.items()},
    )


def parse_regular_league_games(
    league_data: Mapping[str, Any], club_data: Mapping[str, Any]
) -> list[LeagueGame]:
    """Parse all regular league games, rejecting source duplicates deterministically."""
    catalog = build_club_catalog(club_data)
    games: list[LeagueGame] = []
    fixture_keys: set[tuple[str, str, str, str]] = set()
    team_rounds: set[tuple[str, str, str]] = set()

    for league, league_record in league_data.get("leagues", {}).items():
        if "ligapokal" in str(league).casefold():
            continue
        season = _season_for(str(league))
        match_days = league_record.get("match_days", {})
        for round_name, fixture_text in match_days.items():
            for line in str(fixture_text).splitlines():
                parsed = _parse_fixture_line(line)
                if parsed is None:
                    continue
                starts_at_utc, home_name, away_name = parsed
                if _is_bye(home_name) or _is_bye(away_name):
                    continue

                home = _resolve_or_fallback(catalog, home_name)
                away = _resolve_or_fallback(catalog, away_name)
                fixture_key = (
                    str(league),
                    str(round_name),
                    home.normalized_name,
                    away.normalized_name,
                )
                if fixture_key in fixture_keys:
                    raise CalendarSourceError(
                        f"Doppelter Eintrag in {league}, {round_name}: {home_name} - {away_name}"
                    )
                fixture_keys.add(fixture_key)

                for team in (home, away):
                    round_key = (str(league), str(round_name), team.team_id)
                    if round_key in team_rounds:
                        raise CalendarSourceError(
                            f"Mehrere Begegnungen für {team.name} in {league}, {round_name}"
                        )
                    team_rounds.add(round_key)

                location, location_status = _home_location(catalog, home)
                games.append(
                    LeagueGame(
                        season=season,
                        league=str(league),
                        round_name=str(round_name),
                        home=home,
                        away=away,
                        starts_at_utc=starts_at_utc,
                        location=location,
                        location_status=location_status,
                    )
                )
    return games


def _club_aliases(club: Club) -> set[str]:
    canonical = normalize_team_name(club.name)
    aliases = {canonical}
    if canonical.endswith(_LEGAL_FORM_SUFFIX):
        aliases.add(canonical[: -len(_LEGAL_FORM_SUFFIX)])
    for known_alias, canonical_name in _KNOWN_CLUB_ALIASES.items():
        if normalize_team_name(canonical_name) == canonical:
            aliases.add(known_alias)
    return aliases


def _season_for(league: str) -> str:
    match = _SEASON_RE.search(league)
    if match is None:
        raise CalendarSourceError(f"Saison nicht aus Liga ableitbar: {league}")
    return match.group("season")


def _parse_fixture_line(line: str) -> tuple[datetime, str, str] | None:
    match = _DATE_PREFIX_RE.match(line.strip())
    if not match or match.group("hour") is None:
        return None
    teams = _SCORE_SUFFIX_RE.sub("", match.group("teams"))
    team_match = _TEAM_SEPARATOR_RE.match(teams)
    if not team_match:
        return None
    year = int(match.group("year"))
    if year < 100:
        year += 2000
    starts_at_utc = _unambiguous_berlin_time_or_none(
        year,
        int(match.group("month")),
        int(match.group("day")),
        int(match.group("hour")),
        int(match.group("minute")),
    )
    if starts_at_utc is None:
        return None
    return starts_at_utc, team_match.group("home").strip(), team_match.group("away").strip()


def _is_bye(team_name: str) -> bool:
    return normalize_team_name(team_name) in _BYE_NAMES


def _resolve_or_fallback(catalog: ClubCatalog, team_name: str) -> TeamIdentity:
    resolved = catalog.resolve_team(team_name)
    if resolved is not None:
        return resolved
    normalized = normalize_team_name(team_name)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return TeamIdentity(
        name=team_name,
        normalized_name=normalized,
        team_id=f"team-{digest}",
    )


def _home_location(
    catalog: ClubCatalog, home: TeamIdentity
) -> tuple[HomeLocation | None, str]:
    club = catalog.club_for(home)
    if club is None:
        return None, "Austragungsort nicht auflösbar"
    parts = [part for part in (club.venue, club.street, club.city) if part]
    if not parts:
        return None, "Austragungsort unvollständig"
    return (
        HomeLocation(
            venue=club.venue,
            street=club.street,
            city=club.city,
            address=", ".join(parts),
            incomplete=not all((club.venue, club.street, club.city)),
        ),
        "Austragungsort vollständig"
        if all((club.venue, club.street, club.city))
        else "Austragungsort unvollständig",
    )


def _source_text(value: Any) -> str:
    """Keep only actual source text; JSON null and missing values stay empty."""
    return value.strip() if isinstance(value, str) else ""


def _unambiguous_berlin_time_or_none(
    year: int, month: int, day: int, hour: int, minute: int
) -> datetime | None:
    """Return UTC only when both local folds round-trip to one instant."""
    try:
        wall_time = datetime(year, month, day, hour, minute)
    except ValueError:
        return None
    utc_instants = []
    for fold in (0, 1):
        local = wall_time.replace(tzinfo=BERLIN, fold=fold)
        utc_value = local.astimezone(timezone.utc)
        round_trip = utc_value.astimezone(BERLIN).replace(tzinfo=None)
        if round_trip != wall_time:
            return None
        utc_instants.append(utc_value)
    if utc_instants[0] != utc_instants[1]:
        return None
    return utc_instants[0]
